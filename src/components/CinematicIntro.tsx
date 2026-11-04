"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ArrowUpRight } from "lucide-react";

export default function CinematicIntro({ onFinish }: { onFinish: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const skip = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    skip.current?.focus();
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) { onFinish(); return; }
    const stopMotion = () => { if (media.matches) onFinish(); };
    media.addEventListener("change", stopMotion);
    const context = gsap.context(() => {
      gsap.timeline({ onComplete: onFinish })
        .from(".intro-line", { scaleX: 0, duration: 0.9, ease: "power2.out" })
        .from(".intro-word", { opacity: 0, y: 24, letterSpacing: "0.24em", duration: 1.3 }, "-=0.3")
        .from(".intro-subtitle", { opacity: 0, y: 10, duration: 0.7 }, "-=0.6")
        .to(root.current, { opacity: 0, duration: 0.7, delay: 1.2 });
      gsap.to(".intro-particle", { y: -40, opacity: 0.8, stagger: 0.08, duration: 3.8, ease: "sine.inOut" });
    }, root);
    return () => { context.revert(); media.removeEventListener("change", stopMotion); };
  }, [onFinish]);

  return (
    <div ref={root} className="intro" role="dialog" aria-modal="true" aria-label="VITRION introduction">
      <div className="intro-particles" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i className="intro-particle" key={index} style={{ left: `${(index * 37) % 100}%`, top: `${(index * 23) % 100}%` }} />)}</div>
      <div className="intro-content"><span className="eyebrow intro-subtitle">PRECISION BEGINS WITH UNDERSTANDING</span><div className="intro-line" /><h1 className="intro-word">VITRION<span>_01</span></h1><p className="intro-subtitle">ADVANCED ANATOMICAL VISUALIZATION &amp; MEDICAL RESEARCH</p><span className="intro-subtitle intro-note">Anatomical foundation · Research use only</span></div>
      <button ref={skip} className="intro-skip" onClick={onFinish}>Skip intro <ArrowUpRight size={16} /></button>
    </div>
  );
}
