"use client";
import { ContactShadows, Environment, Lightformer } from "@react-three/drei";

/** Key / fill / rim lighting tuned per theme; environment built from local light-formers (no network). */
export function SceneEnvironment({ theme, shadows }: { theme: "dark" | "light"; shadows: boolean }) {
  const dark = theme === "dark";
  return (
    <>
      <color attach="background" args={[dark ? "#0c0e11" : "#e9ebee"]} />
      <hemisphereLight args={[dark ? "#fff4ee" : "#ffffff", dark ? "#2a1715" : "#b9aaa6", dark ? 0.5 : 0.85]} />
      <directionalLight position={[8, 11, 14]} intensity={dark ? 2.5 : 2.2} color="#fff1e6" />
      <directionalLight position={[-12, 2, 8]} intensity={dark ? 0.55 : 0.8} color="#ffe2d8" />
      <directionalLight position={[-7, 7, -14]} intensity={dark ? 1.9 : 0.9} color={dark ? "#9fc0ff" : "#c9d8ff"} />
      <directionalLight position={[3, -9, 4]} intensity={dark ? 0.35 : 0.45} color="#ffd9c9" />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={dark ? 1.4 : 2} position={[0, 6, 10]} scale={[14, 6, 1]} color="#fff3ea" />
        <Lightformer form="rect" intensity={dark ? 0.9 : 1.2} position={[-10, 2, -6]} rotation={[0, Math.PI / 2, 0]} scale={[10, 8, 1]} color="#b9cdf5" />
        <Lightformer form="ring" intensity={0.6} position={[8, -4, 4]} scale={4} color="#ffd8c8" />
      </Environment>
      {shadows && <ContactShadows position={[0, -9.6, 0]} opacity={dark ? 0.55 : 0.35} scale={26} blur={2.6} far={14} resolution={512} frames={1} color={dark ? "#000000" : "#5a4a48"} />}
    </>
  );
}
