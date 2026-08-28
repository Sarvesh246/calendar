export const motion = {
  micro: 0.12,
  standard: 0.2,
  emphasis: 0.35,
  ease: [0.2, 0.8, 0.2, 1] as const,
  spring: { type: "spring" as const, stiffness: 520, damping: 34, mass: 0.55 },
  springSnappy: { type: "spring" as const, stiffness: 640, damping: 38, mass: 0.45 },
};
