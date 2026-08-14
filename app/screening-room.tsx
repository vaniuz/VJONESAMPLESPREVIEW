"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { ScrollSmoother } from "gsap/ScrollSmoother";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import * as THREE from "three";

type ThreeCleanup = () => void;

const VIDEO_SOURCES = [
  "/media/ungasan-vertical.mp4",
  "/media/ungasan-horizontal.mp4",
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

  video.play().catch(() => undefined);

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
  activeSound: number | null;
  onToggleSound: (index: number) => void;
  videoRef: (index: number, video: HTMLVideoElement | null) => void;
  frameRef: (index: number, frame: HTMLElement | null) => void;
  controlRef: (index: number, control: HTMLButtonElement | null) => void;
  onPointerActivity: (index: number, over: boolean) => void;
};

function Film({
  index,
  format,
  caption,
  title,
  description,
  activeSound,
  onToggleSound,
  videoRef,
  frameRef,
  controlRef,
  onPointerActivity,
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
        className="film-frame"
        ref={(node) => frameRef(index, node)}
        onPointerEnter={() => onPointerActivity(index, true)}
        onPointerMove={() => onPointerActivity(index, true)}
        onPointerLeave={() => onPointerActivity(index, false)}
      >
        <div className="video-surface">
          <video
            ref={(node) => videoRef(index, node)}
            className="film-video"
            src={VIDEO_SOURCES[index]}
            crossOrigin="anonymous"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label={caption}
          />
        </div>
        <button
          ref={(node) => controlRef(index, node)}
          type="button"
          className={`sound-control${activeSound === index ? " is-active" : ""}`}
          aria-label={activeSound === index ? "Mute this film" : "Play this film with sound"}
          aria-pressed={activeSound === index}
          data-cursor-target
          onFocus={() => onPointerActivity(index, true)}
          onBlur={() => onPointerActivity(index, false)}
          onClick={() => onToggleSound(index)}
        >
          {activeSound === index ? "MUTE" : "SOUND"}
        </button>
      </div>
    </figure>
  );
}

export function ScreeningRoom() {
  const rootRef = useRef<HTMLDivElement>(null);
  const videosRef = useRef<Array<HTMLVideoElement | null>>([]);
  const framesRef = useRef<Array<HTMLElement | null>>([]);
  const controlsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const hideTimersRef = useRef<Array<ReturnType<typeof setTimeout> | null>>([]);
  const activeSoundRef = useRef<number | null>(null);
  const [activeSound, setActiveSound] = useState<number | null>(null);

  const setVideoRef = useCallback((index: number, node: HTMLVideoElement | null) => {
    videosRef.current[index] = node;
  }, []);

  const setFrameRef = useCallback((index: number, node: HTMLElement | null) => {
    framesRef.current[index] = node;
  }, []);

  const setControlRef = useCallback(
    (index: number, node: HTMLButtonElement | null) => {
      controlsRef.current[index] = node;
    },
    [],
  );

  const toggleSound = useCallback((index: number) => {
    const next = activeSoundRef.current === index ? null : index;
    activeSoundRef.current = next;
    setActiveSound(next);

    videosRef.current.forEach((video, videoIndex) => {
      if (!video) return;
      gsap.killTweensOf(video);

      if (videoIndex === next) {
        video.muted = false;
        video.play().catch(() => undefined);
        gsap.to(video, { volume: 1, duration: 0.3, ease: "vj" });
      } else {
        gsap.to(video, {
          volume: 0,
          duration: 0.3,
          ease: "vj",
          onComplete: () => {
            video.muted = true;
          },
        });
      }
    });
  }, []);

  const handlePointerActivity = useCallback((index: number, over: boolean) => {
    const control = controlsRef.current[index];
    const previousTimer = hideTimersRef.current[index];
    if (previousTimer) clearTimeout(previousTimer);
    if (!control) return;

    gsap.to(control, { opacity: 1, duration: 0.4, ease: "vj" });
    hideTimersRef.current[index] = setTimeout(
      () => {
        gsap.to(control, { opacity: 0, duration: 0.4, ease: "vj" });
      },
      over ? 2000 : 400,
    );
  }, []);

  useLayoutEffect(() => {
    registerMotion();
    const root = rootRef.current;
    if (!root) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const touch = window.matchMedia("(pointer: coarse)").matches || ScrollTrigger.isTouch === 1;
    const splits: SplitText[] = [];
    const threeCleanups: ThreeCleanup[] = [];
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

    if (reducedMotion) {
      const intro = root.querySelector<HTMLElement>(".intro");
      if (intro) gsap.set(intro, { display: "none" });
      root.querySelectorAll<HTMLElement>(".film-frame").forEach((frame) => {
        gsap.set(frame, { clipPath: "inset(0% 0 0 0)", scale: 1, opacity: 1 });
      });
      return () => {
        hideTimersRef.current.forEach((timer) => timer && clearTimeout(timer));
        splits.reverse().forEach((split) => split.revert());
      };
    }

    const setupCursorAndLinks = () => {
      const email = root.querySelector<HTMLAnchorElement>(".email-link");
      const underline = root.querySelector<HTMLElement>(".email-underline");
      if (email && underline) {
        const enter = () => {
          gsap.set(underline, { transformOrigin: "left center" });
          gsap.to(underline, { scaleX: 1, duration: 0.4, ease: "vj" });
        };
        const leave = () => {
          gsap.set(underline, { transformOrigin: "right center" });
          gsap.to(underline, { scaleX: 0, duration: 0.4, ease: "vj" });
        };
        email.addEventListener("pointerenter", enter);
        email.addEventListener("pointerleave", leave);
      }

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
    const accentStroke = root.querySelector<HTMLElement>(".accent-stroke");
    const introChars = introSplit?.chars ?? [];

    gsap.set(loadTargets, { yPercent: 120, opacity: 0 });
    gsap.set(introChars, { yPercent: 120, opacity: 0 });
    if (introCard) {
      gsap.set(introCard, { autoAlpha: 0, scaleX: 0.16, scaleY: 0.2 });
    }
    if (accentStroke) {
      gsap.set(accentStroke, { scaleX: 0, transformOrigin: "right center" });
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
        })
        .to(
          accentStroke,
          { scaleX: 1, duration: 0.8 },
          "<0.32",
        );
    }, 180);

    return () => {
      if (loadTimer) clearTimeout(loadTimer);
      hideTimersRef.current.forEach((timer) => timer && clearTimeout(timer));
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
                  Private viewing · 02 films
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
                <span className="accent-stroke" aria-hidden="true" />
                <p className="hero-copy" data-split data-load-text>
                  Two cinematic directions, created with AI from existing imagery—designed
                  to turn place into feeling, and feeling into desire.
                </p>
                <p className="scroll-cue" data-split data-load-text>
                  View the films
                </p>
              </div>
            </header>

            <Film
              index={0}
              format="vertical"
              caption="Vertical film · Social · 9:16"
              title="Made for the first impression."
              description="A sharper rhythm for social—built to hold attention and make the resort instantly felt."
              activeSound={activeSound}
              onToggleSound={toggleSound}
              videoRef={setVideoRef}
              frameRef={setFrameRef}
              controlRef={setControlRef}
              onPointerActivity={handlePointerActivity}
            />

            <section className="manifesto block">
              <h2 className="manifesto-title" data-split data-scroll-text>
                <span className="manifesto-sans">No new shoot.</span>
                <span className="manifesto-serif">A new way to see</span>
                <span className="manifesto-sans">what already exists.</span>
              </h2>
              <p className="manifesto-note" data-split data-scroll-text>
                AI-assisted. Art-directed. Built from The Ungasan’s existing visual world.
              </p>
            </section>

            <Film
              index={1}
              format="horizontal"
              caption="Brand film · Website · 16:9"
              title="Space, atmosphere, longing."
              description="A widescreen expression for the website, presentations and paid campaigns."
              activeSound={activeSound}
              onToggleSound={toggleSound}
              videoRef={setVideoRef}
              frameRef={setFrameRef}
              controlRef={setControlRef}
              onPointerActivity={handlePointerActivity}
            />

            <section className="closing block">
              <p className="closing-kicker" data-split data-scroll-text>
                The opportunity
              </p>
              <h2 className="closing-copy" data-split data-scroll-text>
                One image library.
                <strong>New cinematic possibilities.</strong>
              </h2>
              <p className="closing-note" data-split data-scroll-text>
                If this direction resonates, I’d be glad to shape the next chapter for The
                Ungasan, Sundays and Weddings.
              </p>

              <div className="email-wrap">
                <p className="contact-label" data-split data-scroll-text>
                  Continue the conversation
                </p>
                <a
                  className="email-link"
                  href="mailto:vjone.official@gmail.com"
                  data-cursor-target
                  data-split
                  data-scroll-text
                >
                  vjone.official@gmail.com
                  <span className="email-underline" aria-hidden="true" />
                </a>
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
    </div>
  );
}
