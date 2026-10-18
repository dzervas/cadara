import { Canvas, useLoader } from "@react-three/fiber";
import {
  Bounds,
  Center,
  ContactShadows,
  Edges,
  Environment,
  Lightformer,
  OrbitControls,
  OrthographicCamera,
} from "@react-three/drei";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import {
  nativeModels,
  nativeMeshUrl,
  type ModelId,
  type NativePart,
} from "./model-assets";

const finishes = {
  silver: { color: "#bfc6cc", metalness: 0.55, roughness: 0.36 },
  graphite: { color: "#7f8a96", metalness: 0.3, roughness: 0.48 },
  orange: { color: "#f0a14a", metalness: 0.38, roughness: 0.36 },
  black: { color: "#14171a", metalness: 0.08, roughness: 0.55 },
};

function Part({
  model,
  part,
  wireframe,
  exploded,
}: {
  model: ModelId;
  part: NativePart;
  wireframe: boolean;
  exploded: boolean;
}) {
  const geometry = useLoader(STLLoader, nativeMeshUrl(model, part));
  return (
    <mesh
      name={part.label}
      geometry={geometry}
      position={exploded ? part.explode : [0, 0, 0]}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial {...finishes[part.finish]} wireframe={wireframe} />
      {!wireframe && (
        <Edges
          threshold={32}
          color={part.finish === "black" ? "#0d1012" : "#30373e"}
          opacity={0.28}
          transparent
        />
      )}
    </mesh>
  );
}

export function ModelScene({
  model,
  wireframe = false,
  exploded = false,
  className,
}: {
  model: ModelId;
  wireframe?: boolean;
  exploded?: boolean;
  className?: string;
}) {
  const asset = nativeModels[model];
  return (
    <div
      className={className}
      style={{ width: "100%", height: "100%", minHeight: 0 }}
    >
      <Canvas
        frameloop="demand"
        dpr={[1, 1.75]}
        shadows
        gl={{ alpha: true, antialias: true }}
        style={{ background: "transparent", touchAction: "none" }}
        aria-label={`CLI-built ${asset.name}. Drag to orbit; scroll to zoom.`}
      >
        <OrthographicCamera
          makeDefault
          position={
            model === "bracket"
              ? [120, 90, -140]
              : model === "enclosure"
                ? [-120, 100, 140]
                : [120, 100, 140]
          }
          near={0.1}
          far={2000}
        />
        {/* Local studio reflections keep satin metal readable without an HDR fetch. */}
        <Environment resolution={128} frames={1} environmentIntensity={0.8}>
          <color attach="background" args={["#707780"]} />
          <Lightformer
            intensity={3}
            position={[0, 5, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            scale={[8, 6, 1]}
          />
          <Lightformer
            intensity={2}
            position={[5, 1, 0]}
            rotation={[0, -Math.PI / 2, 0]}
            scale={[6, 5, 1]}
          />
          <Lightformer
            intensity={2}
            position={[-5, 2, 0]}
            rotation={[0, Math.PI / 2, 0]}
            scale={[6, 5, 1]}
          />
          <Lightformer
            intensity={2}
            position={[0, 2, 5]}
            rotation={[0, Math.PI, 0]}
            scale={[7, 5, 1]}
          />
        </Environment>
        <ambientLight intensity={0.65} />
        <hemisphereLight args={["#e4edff", "#55504a", 1.3]} />
        <directionalLight
          position={model === "bracket" ? [-40, 70, -50] : [-40, 70, 50]}
          intensity={2}
          color="#fff6e9"
        />
        <Bounds
          key={`${model}:${exploded}`}
          fit
          clip
          observe
          margin={1.16}
          maxDuration={0}
        >
          <Center bottom>
            {/* CLI exports retain shared native mm/Z-up coordinates. Rotate the
              assembled group only; no decorative geometry or per-part refitting. */}
            <group rotation={[-Math.PI / 2, 0, 0]}>
              {asset.parts.map((part) => (
                <Part
                  key={part.file}
                  model={model}
                  part={part}
                  wireframe={wireframe}
                  exploded={exploded}
                />
              ))}
            </group>
          </Center>
        </Bounds>
        <ContactShadows
          key={`${model}:${exploded}:${wireframe}`}
          position={[0, -0.4, 0]}
          opacity={0.25}
          scale={180}
          blur={2.3}
          far={70}
          resolution={256}
          frames={1}
        />
        <OrbitControls
          makeDefault
          enablePan={false}
          enableDamping={false}
          minZoom={0.1}
          maxZoom={1000}
          minPolarAngle={0.12}
          maxPolarAngle={Math.PI / 2 - 0.04}
        />
      </Canvas>
    </div>
  );
}

export type { ModelId } from "./model-assets";
