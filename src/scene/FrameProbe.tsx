"use client";
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";

/** Writes a frame counter to the canvas container (data-frames) so automated tests can verify rendering. */
export function FrameProbe() {
  const { gl } = useThree();
  const n = useRef(0);
  useFrame(() => {
    n.current++;
    if (n.current % 30 === 0) gl.domElement.parentElement?.setAttribute("data-frames", String(n.current));
  });
  return null;
}
