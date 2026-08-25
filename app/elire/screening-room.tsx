"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { ScrollSmoother } from "gsap/ScrollSmoother";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import * as THREE from "three";

type ThreeCleanup = () => void;

const DROPBOX_CINEMATIC =
  "https://dl.dropboxusercontent.com/scl/fi/c2pk0s0dgz6hzqgcjopue/Cinematic.mp4?rlkey=7u2ndtx6ylc2xy5vi2nzx9ya3&st=a11vss2s";

const VIDEO_SOURCES = [
  DROPBOX_CINEMATIC,
  "/media/elire-vertical.mp4",
] as const;

let gsapReady = false;

function registerMotion() {
  if (gsapReady) return;
  gsap.registerPlugin(ScrollTrigger, ScrollSmoother, SplitText, CustomEase);
  CustomEase.create("vj", "0.16, 1, 0.3, 1");
  gsapReady = true;
}

function canUseWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl2") || canvas.getContext("webgl")),
    );
  } catch {
    return false;
  }
}

function isLowPowerDevice() {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
  };
  const pixelLoad =
    window.innerWidth *
    window.innerHeight *
    Math.pow(Math.min(window.devicePixelRatio || 1, 2), 2);

  return (
    (nav.hardwareConcurrency ?? 8) <= 4 ||
    (nav.deviceMemory ?? 8) <= 4 ||
    pixelLoad > 6_500_000
  );
}

function createVideoPlane(
  frame: HTMLElement,
  video: HTMLVideoElement,
  getVelocity: () => number,
): ThreeCleanup {
  const surface = frame.querySelector<HTMLElement>(".video-surface");
  if (!surface) return () => undefined;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
  } catch {
    return () => undefined;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = "video-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");
  surface.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;

  const texture = new THREE.VideoTexture(video);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;

  const uniforms = {
    uTexture: { value: texture },
    uVelocity: { value: 0 },
    uTime: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform float uVelocity;
      uniform float uTime;

      void main() {
        const float PI = 3.141592653589793;
        vec2 uv = vUv;
        float curve = sin(uv.x * PI);
        uv.y += uVelocity * 0.06 * curve;

        float separation = abs(uVelocity) * 0.004 * curve;
        float direction = sign(uVelocity);
        vec2 redUv = uv + vec2(0.0, separation * direction);
        vec2 blueUv = uv - vec2(0.0, separation * direction);

        vec4 clean = texture2D(uTexture, uv);
        float red = texture2D(uTexture, redUv).r;
        float blue = texture2D(uTexture, blueUv).b;
        gl_FragColor = vec4(red, clean.g, blue, clean.a);
      }
    `,
  });

  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  const syncToDom = () => {
    const rect = surface.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    renderer.setSize(rect.width, rect.height, false);
    renderer.domElement.style.width = `${rect.width}px`;
    renderer.domElement.style.height = `${rect.height}px`;
    mesh.scale.set(rect.width, rect.height, 1);
    camera.left = -rect.width / 2;
    camera.right = rect.width / 2;
    camera.top = rect.height / 2;
    camera.bottom = -rect.height / 2;
    camera.updateProjectionMatrix();
  };

  let raf = 0;
  let visible = false;
  let currentVelocity = 0;
  let lastTime = performance.now();
  let activated = false;
  let failed = false;

  const render = (now: number) => {
    if (!visible || failed) return;

    const targetVelocity = getVelocity();
    currentVelocity += (targetVelocity - currentVelocity) * 0.08;
    if (Math.abs(targetVelocity) < 0.0001 && Math.abs(currentVelocity) < 0.055) {
      currentVelocity = 0;
    }

    try {
      uniforms.uVelocity.value = currentVelocity;
      uniforms.uTime.value += Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      renderer.render(scene, camera);
      if (!activated) {
        activated = true;
        frame.classList.add("webgl-active");
      }
    } catch {
      failed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      observer.disconnect();
      renderer.domElement.remove();
      return;
    }
    raf = requestAnimationFrame(render);
  };

  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !raf) {
        lastTime = performance.now();
        raf = requestAnimationFrame(render);
      } else if (!visible && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { rootMargin: "10% 0px" },
  );

  const handleContextLoss = () => {
    frame.classList.remove("webgl-active");
  };

  renderer.domElement.addEventListener("webglcontextlost", handleContextLoss);
  window.addEventListener("resize", syncToDom, { passive: true });
  window.addEventListener("scroll", syncToDom, { passive: true });
  observer.observe(frame);
  syncToDom();

  return () => {
    visible = false;
    if (raf) cancelAnimationFrame(raf);
    observer.disconnect();
    window.removeEventListener("resize", syncToDom);
    window.removeEventListener("scroll", syncToDom);
    renderer.domElement.removeEventListener("webglcontextlost", handleContextLoss);
    frame.classList.remove("webgl-active");
    geometry.dispose();
    material.dispose();
    texture.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}

type FilmProps = {
  index: number;
  format: "vertical" | "horizontal";
  caption: string;
  title: string;
  description: string;
  isPlaying: boolean;
  isMuted: boolean;
  isWatched: boolean;
  minimal?: boolean;
  onOpenVideo: (index: number) => void;
  onTogglePlayback: (index: number) => void;
  onToggleSound: (index: number) => void;
  videoRef: (index: number, video: HTMLVideoElement | null) => void;
  frameRef: (index: number, frame: HTMLElement | null) => void;
};

function Film({
  index,
  format,
  caption,
  title,
  description,
  isPlaying,
  isMuted,
  isWatched,
  minimal,
  onOpenVideo,
  onTogglePlayback,
  onToggleSound,
  videoRef,
  frameRef,
}: FilmProps) {
  return (
    <figure className={`film film--${format} block${minimal ? " film--minimal" : ""}`}>
      <figcaption className="film-meta">
        <p className="film-number" data-split data-scroll-text>
          0{index + 1}
        </p>
        <div className="film-heading">
          <p className="film-kicker" data-split data-scroll-text>
            {caption}
          </p>
          <h2 className="film-title" data-split data-scroll-text>
            {title}
          </h2>
        </div>
        <p className="film-description" data-split data-scroll-text>
          {description}
        </p>
      </figcaption>
      <div
        className={`film-frame${isWatched ? " is-watched" : ""}`}
        ref={(node) => frameRef(index, node)}
        role="button"
        tabIndex={0}
        aria-label={`Watch ${caption} with sound`}
        data-cursor-target
        onClick={() => onOpenVideo(index)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenVideo(index);
          }
        }}
      >
        <div className="video-surface">
          <video
            ref={(node) => videoRef(index, node)}
            className="film-video"
            src={VIDEO_SOURCES[index]}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            controlsList="nodownload noplaybackrate noremoteplayback"
            disablePictureInPicture
            onContextMenu={(event) => event.preventDefault()}
            aria-label={caption}
          />
        </div>
        <div className="watch-prompt" aria-hidden="true" />
        <div className="video-controls" aria-label={`${caption} playback controls`}>
          <button
            className="video-control video-control--play"
            type="button"
            aria-label={isPlaying ? "Pause film" : "Play film"}
            aria-pressed={isPlaying}
            onClick={(event) => {
              event.stopPropagation();
              onTogglePlayback(index);
            }}
          >
            <span className={isPlaying ? "pause-icon" : "play-icon"} aria-hidden="true" />
            <span className="control-label">{isPlaying ? "Pause" : "Play"}</span>
          </button>
          <span className="control-divider" aria-hidden="true" />
          <button
            className={`video-control video-control--sound${isMuted ? " is-muted" : ""}`}
            type="button"
            aria-label={isMuted ? "Turn sound on" : "Mute film"}
            aria-pressed={!isMuted}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSound(index);
            }}
          >
            <span className="sound-bars" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="control-label">Sound {isMuted ? "off" : "on"}</span>
          </button>
        </div>
      </div>
    </figure>
  );
}

export function ScreeningRoom() {
  const rootRef = useRef<HTMLDivElement>(null);
  const videosRef = useRef<Array<HTMLVideoElement | null>>([]);
  const framesRef = useRef<Array<HTMLElement | null>>([]);
  const watchedVideosRef = useRef<boolean[]>([true, false]);
  const [playingVideos, setPlayingVideos] = useState<boolean[]>([false, false]);
  const [mutedVideos, setMutedVideos] = useState<boolean[]>([true, true]);
  const [watchedVideos, setWatchedVideos] = useState<boolean[]>([true, false]);
  const [showPlayBtn, setShowPlayBtn] = useState<boolean>(true);

  const setVideoRef = useCallback((index: number, node: HTMLVideoElement | null) => {
    videosRef.current[index] = node;
  }, []);

  const setFrameRef = useCallback((index: number, node: HTMLElement | null) => {
    framesRef.current[index] = node;
  }, []);

  const openVideo = useCallback((index: number, fullscreen = false) => {
    const video = videosRef.current[index] as
      | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
      | null;
    if (!video) return;

    const frame = framesRef.current[index] as
      | (HTMLElement & { webkitRequestFullscreen?: () => void })
      | null;

    watchedVideosRef.current[index] = true;
    setWatchedVideos((current) => current.map((watched, item) => watched || item === index));
    videosRef.current.forEach((otherVideo, otherIndex) => {
      if (!otherVideo || otherIndex === index) return;
      otherVideo.muted = true;
      otherVideo.volume = 0;
      otherVideo.pause();
    });
    setPlayingVideos((current) => current.map((_, item) => item === index));
    setMutedVideos((current) => current.map((_, item) => item !== index));

    video.pause();
    video.currentTime = 0;
    video.muted = false;
    video.volume = 1;
    video.play().catch(() => undefined);

    if (fullscreen) {
      if (frame?.requestFullscreen) {
        frame.requestFullscreen().catch(() => undefined);
      } else if (frame?.webkitRequestFullscreen) {
        frame.webkitRequestFullscreen();
      } else {
        video.webkitEnterFullscreen?.();
      }
    }
  }, []);

  const togglePlayback = useCallback((index: number) => {
    const video = videosRef.current[index];
    if (!video) return;

    if (video.paused) {
      video.play().catch(() => undefined);
      setPlayingVideos((current) => current.map((playing, item) => item === index ? true : playing));
    } else {
      video.pause();
      setPlayingVideos((current) => current.map((playing, item) => item === index ? false : playing));
    }
  }, []);

  const toggleSound = useCallback((index: number) => {
    const video = videosRef.current[index];
    if (!video) return;

    const nextMuted = !video.muted;
    video.muted = nextMuted;
    video.volume = nextMuted ? 0 : 1;
    setMutedVideos((current) => current.map((muted, item) => item === index ? nextMuted : muted));
  }, []);

  useLayoutEffect(() => {
    registerMotion();
    const root = rootRef.current;
    if (!root) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const touch = window.matchMedia("(pointer: coarse)").matches || ScrollTrigger.isTouch === 1;
    const splits: SplitText[] = [];
    const threeCleanups: ThreeCleanup[] = [];
    const playbackObservers: IntersectionObserver[] = [];
    let smoother: ScrollSmoother | undefined;
    let velocityTrigger: ScrollTrigger | undefined;
    let loadTimer: ReturnType<typeof setTimeout> | undefined;
    let velocityTarget = 0;
    let velocityTimestamp = 0;

    const splitElements = Array.from(root.querySelectorAll<HTMLElement>("[data-split]"));
    const linesByElement = new Map<HTMLElement, Element[]>();
    const charsByElement = new Map<HTMLElement, Element[]>();

    splitElements.forEach((element) => {
      const charReveal = element.hasAttribute("data-char-reveal");
      const split = SplitText.create(element, {
        type: charReveal ? "lines,chars" : "lines",
        linesClass: "split-line",
        charsClass: "hero-char",
      });
      splits.push(split);

      split.lines.forEach((line) => {
        const parent = line.parentNode;
        if (!parent) return;
        const mask = document.createElement("span");
        mask.className = "line-mask";
        parent.insertBefore(mask, line);
        mask.appendChild(line);
      });
      linesByElement.set(element, split.lines);
      if (charReveal) charsByElement.set(element, split.chars);
    });

    const stopFullscreenPlayback = () => {
      if (document.fullscreenElement) return;
      videosRef.current.forEach((video) => {
        if (!video) return;
        video.muted = true;
        video.volume = 0;
        video.pause();
      });
      setPlayingVideos([false, false]);
      setMutedVideos([true, true]);
    };

    document.addEventListener("fullscreenchange", stopFullscreenPlayback);
    videosRef.current.forEach((video) => {
      video?.addEventListener("webkitendfullscreen", stopFullscreenPlayback);
    });

    framesRef.current.forEach((frame, index) => {
      const video = videosRef.current[index];
      if (!frame || !video) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            video.muted = true;
            video.volume = 0;
            video.play().catch(() => undefined);
            setPlayingVideos((current) => current.map((playing, item) => item === index ? true : playing));
            setMutedVideos((current) => current.map((muted, item) => item === index ? true : muted));
          } else {
            video.muted = true;
            video.volume = 0;
            video.pause();
            setPlayingVideos((current) => current.map((playing, item) => item === index ? false : playing));
            setMutedVideos((current) => current.map((muted, item) => item === index ? true : muted));
          }
        },
        { threshold: 0.42 },
      );

      observer.observe(frame);
      playbackObservers.push(observer);
    });

    if (reducedMotion) {
      const intro = root.querySelector<HTMLElement>(".intro");
      if (intro) gsap.set(intro, { display: "none" });
      root.querySelectorAll<HTMLElement>(".film-frame").forEach((frame) => {
        gsap.set(frame, { clipPath: "inset(0% 0 0 0)", scale: 1, opacity: 1 });
      });
      return () => {
        playbackObservers.forEach((observer) => observer.disconnect());
        splits.reverse().forEach((split) => split.revert());
      };
    }

    const setupCursorAndLinks = () => {
      root.querySelectorAll<HTMLAnchorElement>(".contact-link").forEach((link) => {
        const underline = link.querySelector<HTMLElement>(".contact-underline");
        if (!underline) return;
        const enter = () => {
          gsap.set(underline, { transformOrigin: "left center" });
          gsap.to(underline, { scaleX: 1, duration: 0.4, ease: "vj" });
        };
        const leave = () => {
          gsap.set(underline, { transformOrigin: "right center" });
          gsap.to(underline, { scaleX: 0, duration: 0.4, ease: "vj" });
        };
        link.addEventListener("pointerenter", enter);
        link.addEventListener("pointerleave", leave);
      });

      if (touch) return;
      const cursor = root.querySelector<HTMLElement>(".cursor");
      if (!cursor) return;

      gsap.set(cursor, { xPercent: -50, yPercent: -50 });
      const xTo = gsap.quickTo(cursor, "x", { duration: 0.5, ease: "power3" });
      const yTo = gsap.quickTo(cursor, "y", { duration: 0.5, ease: "power3" });
      const move = (event: PointerEvent) => {
        xTo(event.clientX);
        yTo(event.clientY);
        gsap.to(cursor, { opacity: 1, duration: 0.4, ease: "vj" });
      };
      window.addEventListener("pointermove", move, { passive: true });

      root.querySelectorAll<HTMLElement>("[data-cursor-target]").forEach((target) => {
        target.addEventListener("pointerenter", () => {
          gsap.to(cursor, { scale: 4, opacity: 0.2, duration: 0.4, ease: "vj" });
        });
        target.addEventListener("pointerleave", () => {
          gsap.to(cursor, { scale: 1, opacity: 1, duration: 0.4, ease: "vj" });
        });
      });
    };

    const setupScroll = () => {
      if (!touch) {
        smoother = ScrollSmoother.create({
          wrapper: "#smooth-wrapper",
          content: "#smooth-content",
          smooth: 1.4,
          effects: true,
          normalizeScroll: true,
        });
      }

      root.querySelectorAll<HTMLElement>("[data-scroll-text]").forEach((element) => {
        const lines = linesByElement.get(element);
        if (!lines?.length) return;
        gsap.from(lines, {
          yPercent: 115,
          opacity: 0,
          duration: 1.1,
          stagger: 0.09,
          ease: "vj",
          scrollTrigger: {
            trigger: element,
            start: "top 78%",
            once: true,
            toggleActions: "play none none none",
          },
        });
      });

      framesRef.current.forEach((frame) => {
        if (!frame) return;
        gsap.fromTo(
          frame,
          { clipPath: "inset(100% 0 0 0)", scale: 0.96, opacity: 0 },
          {
            clipPath: "inset(0% 0 0 0)",
            scale: 1,
            opacity: 1,
            duration: 1.2,
            ease: "vj",
            scrollTrigger: {
              trigger: frame,
              start: "top 78%",
              once: true,
              toggleActions: "play none none none",
            },
          },
        );
      });

      velocityTrigger = ScrollTrigger.create({
        start: 0,
        end: "max",
        onUpdate: (self) => {
          const raw = self.getVelocity();
          velocityTarget = THREE.MathUtils.clamp(raw / 2400, -1, 1);
          velocityTimestamp = performance.now();
        },
      });

      const shouldUseThree =
        !touch && !isLowPowerDevice() && canUseWebGL();

      if (shouldUseThree) {
        const getVelocity = () => {
          if (performance.now() - velocityTimestamp > 120) velocityTarget = 0;
          return velocityTarget;
        };

        framesRef.current.forEach((frame, index) => {
          const video = videosRef.current[index];
          const isLocalSource = VIDEO_SOURCES[index].startsWith("/");
          if (frame && video && isLocalSource) {
            threeCleanups.push(createVideoPlane(frame, video, getVelocity));
          }
        });
      }

      ScrollTrigger.refresh();
    };

    setupCursorAndLinks();

    const loadTargets = Array.from(
      root.querySelectorAll<HTMLElement>("[data-load-text]"),
    ).flatMap(
      (element) => charsByElement.get(element) ?? linesByElement.get(element) ?? [],
    );

    const intro = root.querySelector<HTMLElement>(".intro");
    const introCard = root.querySelector<HTMLElement>(".intro-card");
    const introDot = root.querySelector<HTMLElement>(".intro-dot");
    const introWord = root.querySelector<HTMLElement>("[data-intro-word]");
    const introSplit = introWord
      ? SplitText.create(introWord, { type: "chars", charsClass: "intro-char" })
      : undefined;
    if (introSplit) splits.push(introSplit);
    const introChars = introSplit?.chars ?? [];

    gsap.set(loadTargets, { yPercent: 120, opacity: 0 });
    gsap.set(introChars, { yPercent: 120, opacity: 0 });
    if (introCard) {
      gsap.set(introCard, { autoAlpha: 0, scaleX: 0.16, scaleY: 0.2 });
    }
    loadTimer = setTimeout(() => {
      const introTimeline = gsap.timeline({ defaults: { ease: "vj" } });

      introTimeline
        .to(introChars, {
          yPercent: 0,
          opacity: 1,
          duration: 0.7,
          stagger: 0.045,
        })
        .to(
          introDot,
          { scale: 1, duration: 0.45 },
          "<0.25",
        )
        .to({}, { duration: 0.24 })
        .to(introCard, { autoAlpha: 1, duration: 0.01 })
        .to(introCard, {
          scaleX: 1.08,
          scaleY: 1.08,
          duration: 0.95,
        })
        .set(intro, { autoAlpha: 0, pointerEvents: "none" })
        .to(loadTargets, {
          yPercent: 0,
          opacity: 1,
          duration: 1.05,
          stagger: 0.025,
          onComplete: setupScroll,
        });
    }, 180);

    return () => {
      if (loadTimer) clearTimeout(loadTimer);
      playbackObservers.forEach((observer) => observer.disconnect());
      document.removeEventListener("fullscreenchange", stopFullscreenPlayback);
      videosRef.current.forEach((video) => {
        video?.removeEventListener("webkitendfullscreen", stopFullscreenPlayback);
      });
      threeCleanups.forEach((cleanup) => cleanup());
      velocityTrigger?.kill();
      smoother?.kill();
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      gsap.killTweensOf("*");
      splits.reverse().forEach((split) => split.revert());
    };
  }, []);

  return (
    <div ref={rootRef} className="screening-room elire">
      <div className="intro" aria-hidden="true">
        <div className="intro-wordmark">
          <span className="intro-word" data-intro-word>
            vj one
          </span>
          <span className="intro-dot" />
        </div>
        <div className="intro-card" />
      </div>

      <div id="smooth-wrapper">
        <div id="smooth-content">
          <main className="column">
            <div className="topbar" aria-label="Presentation details">
              <span className="wordmark" data-split data-load-text>
                vj one.
              </span>
              <div className="topbar-meta">
                <span data-split data-load-text>
                  ELIRE · Business Bay, Dubai
                </span>
                <span className="topbar-chip" data-split data-load-text>
                  Private viewing · 02 films
                </span>
              </div>
            </div>

            <header className="hero">
              <div className="hero-text">
                <p className="eyebrow" data-split data-load-text>
                  ELIRE · Business Bay, Dubai
                  <br />
                  Prepared for Andrey Lazarev · QUBE Development
                </p>
                <h1 className="hero-title" data-split data-load-text data-char-reveal>
                  ELIRE
                </h1>
              </div>

              <figure className="hero-film">
                <div
                  className={`film-frame hero-film-frame${watchedVideos[0] ? " is-watched" : ""}`}
                  ref={(node) => setFrameRef(0, node)}
                  role="button"
                  tabIndex={0}
                  aria-label="Watch the concept film with sound"
                  data-cursor-target
                  onClick={() => {
                    setShowPlayBtn(false);
                    openVideo(0, true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setShowPlayBtn(false);
                      openVideo(0, true);
                    }
                  }}
                >
                  <div className="video-surface">
                    <video
                      ref={(node) => setVideoRef(0, node)}
                      className="film-video"
                      src={VIDEO_SOURCES[0]}
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      controlsList="nodownload noplaybackrate noremoteplayback"
                      disablePictureInPicture
                      onContextMenu={(event) => event.preventDefault()}
                      aria-label="CONCEPT FILM"
                    />
                  </div>
                  {showPlayBtn && (
                    <button
                      type="button"
                      className="hero-play-btn"
                      aria-label="Play concept film"
                      onClick={() => {
                        setShowPlayBtn(false);
                        openVideo(0, true);
                      }}
                    >
                      <span className="hero-play-label">CLICK</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="video-close"
                    aria-label="Close"
                    onClick={(event) => {
                      event.stopPropagation();
                      document.exitFullscreen?.();
                    }}
                  >
                    ×
                  </button>
                  <div className="watch-prompt" aria-hidden="true" />
                  <div className="video-controls" aria-label="Concept film playback controls">
                    <button
                      className="video-control video-control--play"
                      type="button"
                      aria-label={playingVideos[0] ? "Pause film" : "Play film"}
                      aria-pressed={playingVideos[0]}
                      onClick={(event) => {
                        event.stopPropagation();
                        togglePlayback(0);
                      }}
                    >
                      <span className={playingVideos[0] ? "pause-icon" : "play-icon"} aria-hidden="true" />
                      <span className="control-label">{playingVideos[0] ? "Pause" : "Play"}</span>
                    </button>
                    <span className="control-divider" aria-hidden="true" />
                    <button
                      className={`video-control video-control--sound${mutedVideos[0] ? " is-muted" : ""}`}
                      type="button"
                      aria-label={mutedVideos[0] ? "Turn sound on" : "Mute film"}
                      aria-pressed={!mutedVideos[0]}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleSound(0);
                      }}
                    >
                      <span className="sound-bars" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span className="control-label">Sound {mutedVideos[0] ? "off" : "on"}</span>
                    </button>
                  </div>
                </div>
                <figcaption className="hero-film-meta">
                  <span className="hero-film-kicker">CONCEPT FILM</span>
                  <span className="hero-film-cap">Built from ELIRE&rsquo;s published renders.</span>
                </figcaption>
              </figure>
            </header>

            <Film
              index={1}
              format="vertical"
              caption="BEFORE / AFTER"
              title="Before and after."
              description="Same renders, different feeling."
              minimal
              isPlaying={playingVideos[1]}
              isMuted={mutedVideos[1]}
              isWatched={watchedVideos[1]}
              onOpenVideo={(index) => openVideo(index, false)}
              onTogglePlayback={togglePlayback}
              onToggleSound={toggleSound}
              videoRef={setVideoRef}
              frameRef={setFrameRef}
            />

            <section className="closing block">
              <h2 className="closing-copy closing-copy--small" data-split data-scroll-text>
                Desire begins beforehand.
              </h2>

              <div className="email-wrap">
                <div className="contact-links">
                  <a
                    className="contact-link"
                    href="mailto:vjone.official@gmail.com"
                    data-cursor-target
                    data-split
                    data-scroll-text
                  >
                    vjone.official@gmail.com
                    <span className="contact-underline" aria-hidden="true" />
                  </a>
                  <a
                    className="contact-link"
                    href="https://wa.me/553123420754"
                    target="_blank"
                    rel="noopener noreferrer"
                    data-cursor-target
                    data-split
                    data-scroll-text
                  >
                    WhatsApp
                    <span className="contact-underline" aria-hidden="true" />
                  </a>
                </div>
              </div>

              <div className="footer-mark">
                <span data-split data-scroll-text>VJ ONE</span>
                <span data-split data-scroll-text>CONCEPT STUDY · QUBE DEVELOPMENT × THE LUX COLLECTIVE</span>
              </div>
            </section>
          </main>
        </div>
      </div>
      <div className="cursor" aria-hidden="true" />
    </div>
  );
}