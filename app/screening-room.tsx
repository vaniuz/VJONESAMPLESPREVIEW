"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { ScrollSmoother } from "gsap/ScrollSmoother";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import * as THREE from "three";

type ThreeCleanup = () => void;

const VIDEO_SOURCES = [
  "/media/ungasan-new.mp4",
  "/media/ungasan-vertical.mp4",
  "/media/ungasan-horizontal.mp4",
] as const;

let gsapReady = false;

function registerMotion() {
  if (gsapReady) return;
  gsap.registerPlugin(ScrollTrigger, ScrollSmoother, SplitText, CustomEase);
  try {
    CustomEase.create("vj", "0.16, 1, 0.3, 1");
  } catch {
    gsap.registerEase("vj", "power3.out");
  }
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

  const render = (now: number) => {
    if (!visible) return;

    const targetVelocity = getVelocity();
    currentVelocity += (targetVelocity - currentVelocity) * 0.08;
    if (Math.abs(targetVelocity) < 0.0001 && Math.abs(currentVelocity) < 0.055) {
      currentVelocity = 0;
    }

    uniforms.uVelocity.value = currentVelocity;
    uniforms.uTime.value += Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    renderer.render(scene, camera);
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
  frame.classList.add("webgl-active");

  return () => {
    visible = false;
    cancelAnimationFrame(raf);
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
  onOpenVideo,
  onTogglePlayback,
  onToggleSound,
  videoRef,
  frameRef,
}: FilmProps) {
  return (
    <figure className={`film film--${format} block`}>
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
        aria-label={`Watch ${caption} from the beginning in full screen with sound`}
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
            crossOrigin="anonymous"
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
        <div className="watch-prompt" aria-hidden="true">
          <span>Click to watch</span>
        </div>
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
  const watchedVideosRef = useRef<boolean[]>([false, false, false]);
  const [playingVideos, setPlayingVideos] = useState<boolean[]>([false, false, false]);
  const [mutedVideos, setMutedVideos] = useState<boolean[]>([true, true, true]);
  const [watchedVideos, setWatchedVideos] = useState<boolean[]>([false, false, false]);
  const [overlayIndex, setOverlayIndex] = useState<number | null>(null);
  const [overlayPlaying, setOverlayPlaying] = useState(false);
  const [overlayMuted, setOverlayMuted] = useState(false);
  const overlayVideoRef = useRef<HTMLVideoElement | null>(null);

  const setVideoRef = useCallback((index: number, node: HTMLVideoElement | null) => {
    videosRef.current[index] = node;
  }, []);

  const setFrameRef = useCallback((index: number, node: HTMLElement | null) => {
    framesRef.current[index] = node;
  }, []);

  const openVideo = useCallback((index: number) => {
    const video = videosRef.current[index];
    if (!video) return;

    watchedVideosRef.current[index] = true;
    setWatchedVideos((current) => current.map((watched, item) => watched || item === index));

    videosRef.current.forEach((otherVideo, otherIndex) => {
      if (!otherVideo || otherIndex === index) return;
      otherVideo.muted = true;
      otherVideo.volume = 0;
      otherVideo.pause();
    });
    setPlayingVideos((current) => current.map(() => false));
    setMutedVideos((current) => current.map(() => true));

    video.pause();
    video.currentTime = 0;
    video.muted = true;
    video.volume = 0;
    document.documentElement.classList.add("video-overlay-open");

    setOverlayIndex(index);
    setOverlayPlaying(true);
    setOverlayMuted(false);
  }, []);

  const closeVideo = useCallback(() => {
    document.documentElement.classList.remove("video-overlay-open");
    const overlayVideo = overlayVideoRef.current;
    if (overlayVideo) {
      overlayVideo.pause();
      overlayVideo.muted = true;
      overlayVideo.volume = 0;
    }
    setOverlayPlaying(false);
    setOverlayIndex(null);
  }, []);

  const toggleOverlayPlayback = useCallback(() => {
    const video = overlayVideoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => undefined);
      setOverlayPlaying(true);
    } else {
      video.pause();
      setOverlayPlaying(false);
    }
  }, []);

  const toggleOverlaySound = useCallback(() => {
    setOverlayMuted((muted) => {
      const nextMuted = !muted;
      const video = overlayVideoRef.current;
      if (video) {
        video.muted = nextMuted;
        video.volume = nextMuted ? 0 : 1;
      }
      return nextMuted;
    });
  }, []);

  const handleOverlayKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeVideo();
      }
    },
    [closeVideo],
  );

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

    const introWord = root.querySelector<HTMLElement>("[data-intro-word]");
    const introSplit = introWord
      ? SplitText.create(introWord, { type: "chars", charsClass: "intro-char" })
      : undefined;
    if (introSplit) splits.push(introSplit);

    const stopFullscreenPlayback = () => {
      if (document.fullscreenElement) return;
      framesRef.current.forEach((frame) => {
        frame?.classList.remove("vertical-fullscreen");
      });
      rootRef.current?.classList.remove("is-fullscreen");
      videosRef.current.forEach((video) => {
        if (!video) return;
        video.muted = true;
        video.volume = 0;
        video.pause();
      });
      setPlayingVideos([false, false, false, false]);
      setMutedVideos([true, true, true, true]);
    };

    const handleFullscreenChange = () => {
      if (document.fullscreenElement) {
        rootRef.current?.classList.add("is-fullscreen");
      } else {
        rootRef.current?.classList.remove("is-fullscreen");
        framesRef.current.forEach((frame) => {
          frame?.classList.remove("vertical-fullscreen");
        });
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    videosRef.current.forEach((video) => {
      video?.addEventListener("webkitendfullscreen", stopFullscreenPlayback);
    });

    framesRef.current.forEach((frame, index) => {
      const video = videosRef.current[index];
      if (!frame || !video) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          const inFullscreen = document.fullscreenElement === frame;
          if (entry.isIntersecting && watchedVideosRef.current[index] && !inFullscreen) {
            video.muted = true;
            video.volume = 0;
            video.play().catch(() => undefined);
            setPlayingVideos((current) => current.map((playing, item) => item === index ? true : playing));
            setMutedVideos((current) => current.map((muted, item) => item === index ? true : muted));
          } else if (!entry.isIntersecting && !inFullscreen) {
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
        document.removeEventListener("fullscreenchange", stopFullscreenPlayback);
        videosRef.current.forEach((video) => {
          video?.removeEventListener("webkitendfullscreen", stopFullscreenPlayback);
        });
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
          if (frame && video) {
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

    // Safety fallback: force hide intro after 3.5s in case animation fails
    const introSafetyTimer = setTimeout(() => {
      if (intro) {
        gsap.set(intro, { autoAlpha: 0, pointerEvents: "none" });
      }
    }, 3500);

    return () => {
      if (loadTimer) clearTimeout(loadTimer);
      if (introSafetyTimer) clearTimeout(introSafetyTimer);
      document.documentElement.classList.remove("video-overlay-open");
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
    <div ref={rootRef} className="screening-room">
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
                  The Ungasan · Bali
                </span>
                <span className="topbar-chip" data-split data-load-text>
                  Private viewing · 03 films
                </span>
              </div>
            </div>

            <header className="hero">
              <div className="hero-inner">
                <p className="eyebrow" data-split data-load-text>
                  Prepared for Icha Annisa · The Ungasan Clifftop Resort
                </p>
                <h1 className="hero-title" data-split data-load-text data-char-reveal>
                  <span className="title-sans">The Ungasan</span>
                  <span className="title-serif">in motion.</span>
                </h1>
                <p className="hero-copy" data-split data-load-text>
                  Two cinematic directions designed to turn place into feeling—and feeling
                  into desire.
                </p>
                <p className="scroll-cue" data-split data-load-text>
                  View the films
                </p>
              </div>
            </header>

            <Film
              index={0}
              format="horizontal"
              caption=""
              title="The story begins wide."
              description="Cinematic — space, atmosphere, and the feeling of arrival."
              isPlaying={playingVideos[0]}
              isMuted={mutedVideos[0]}
              isWatched={watchedVideos[0]}
              onOpenVideo={openVideo}
              onTogglePlayback={togglePlayback}
              onToggleSound={toggleSound}
              videoRef={setVideoRef}
              frameRef={setFrameRef}
            />

            <Film
              index={1}
              format="vertical"
              caption="Vertical film · Social · 9:16"
              title="Made for the first impression."
              description="A sharper rhythm for social—built to hold attention and make the resort instantly felt. Opens in 9:16."
              isPlaying={playingVideos[1]}
              isMuted={mutedVideos[1]}
              isWatched={watchedVideos[1]}
              onOpenVideo={openVideo}
              onTogglePlayback={togglePlayback}
              onToggleSound={toggleSound}
              videoRef={setVideoRef}
              frameRef={setFrameRef}
            />

            <Film
              index={2}
              format="horizontal"
              caption="Brand film · Website · 16:9"
              title="Space, atmosphere, longing."
              description="A widescreen expression for the website, presentations and paid campaigns."
              isPlaying={playingVideos[2]}
              isMuted={mutedVideos[2]}
              isWatched={watchedVideos[2]}
              onOpenVideo={openVideo}
              onTogglePlayback={togglePlayback}
              onToggleSound={toggleSound}
              videoRef={setVideoRef}
              frameRef={setFrameRef}
            />

            <section className="closing block">
              <p className="closing-kicker" data-split data-scroll-text>
                The opportunity
              </p>
              <h2 className="closing-copy" data-split data-scroll-text>
                <strong>Direction, strategy &amp; agility.</strong>
                <span className="closing-subline">The frame that wins the client.</span>
              </h2>
              <p className="closing-note" data-split data-scroll-text>
                If this direction resonates, I’d be glad to shape the next chapter for The
                Ungasan, Sundays and Weddings.
              </p>

              <div className="email-wrap">
                <p className="contact-label" data-split data-scroll-text>
                  Continue the conversation
                </p>
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
                    href="https://wa.me/553123420754?text=Hello%20Vanius%2C%20I%27d%20like%20to%20discuss%20The%20Ungasan%20film%20direction."
                    target="_blank"
                    rel="noreferrer"
                    data-cursor-target
                    data-split
                    data-scroll-text
                  >
                    WhatsApp ↗
                    <span className="contact-underline" aria-hidden="true" />
                  </a>
                </div>
              </div>

              <div className="footer-mark">
                <span data-split data-scroll-text>VJ ONE · CINEMATIC VISUALS</span>
                <span data-split data-scroll-text>PRIVATE PRESENTATION · 2026</span>
              </div>
            </section>
          </main>
        </div>
      </div>

      <div className="cursor" aria-hidden="true" />

      {overlayIndex !== null ? (
        <div
          className="video-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Video playback"
          onKeyDown={handleOverlayKeyDown}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeVideo();
          }}
        >
          <button
            className="overlay-close"
            type="button"
            aria-label="Close video"
            onClick={closeVideo}
          >
            <span className="close-icon" aria-hidden="true">
              ×
            </span>
            <span className="close-label">Close</span>
          </button>

          <div className="overlay-stage">
            <div
              className={`overlay-aspect-ratio${overlayIndex === 1 ? " is-vertical" : ""}`}
            >
              <video
                ref={overlayVideoRef}
                className="overlay-video"
                src={VIDEO_SOURCES[overlayIndex]}
                crossOrigin="anonymous"
                autoPlay
                loop
                playsInline
                muted={overlayMuted}
                controlsList="nodownload noplaybackrate noremoteplayback"
                disablePictureInPicture
                onContextMenu={(event) => event.preventDefault()}
                onPlay={() => setOverlayPlaying(true)}
                onPause={() => setOverlayPlaying(false)}
              />
            </div>

            <div className="overlay-controls" aria-label="Playback controls">
              <button
                className="overlay-control"
                type="button"
                aria-label={overlayPlaying ? "Pause video" : "Play video"}
                onClick={toggleOverlayPlayback}
              >
                <span className={overlayPlaying ? "pause-icon" : "play-icon"} aria-hidden="true" />
                <span className="control-label">{overlayPlaying ? "Pause" : "Play"}</span>
              </button>
              <span className="control-divider" aria-hidden="true" />
              <button
                className={`overlay-control${overlayMuted ? " is-muted" : ""}`}
                type="button"
                aria-label={overlayMuted ? "Turn sound on" : "Mute video"}
                onClick={toggleOverlaySound}
              >
                <span className="sound-bars" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="control-label">Sound {overlayMuted ? "off" : "on"}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
