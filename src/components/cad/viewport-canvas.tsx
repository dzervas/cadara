import {
  createRoot,
  events,
  extend,
  type ReconcilerRoot,
  type RootState,
} from "@react-three/fiber";
import {
  Component,
  Suspense,
  useLayoutEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import * as THREE from "three";

import {
  WebGlInitializationError,
  type WebGlSurface,
} from "@/infrastructure/viewport/webgl-renderer";

// Match Canvas's catalogue registration, including Three's non-constructor exports.
extend(THREE as unknown as Parameters<typeof extend>[0]);

interface ViewportCanvasProps extends PropsWithChildren {
  createRenderer: (
    parameters: THREE.WebGLRendererParameters,
    surface: WebGlSurface,
  ) => THREE.WebGLRenderer;
  onGraphicsFailure: (error: WebGlInitializationError) => void;
  onCreated: (state: RootState) => void;
}

// Canvas in R3F 9.6.1 leaves configure() rejections unhandled. Own only this
// lifecycle through its public API so a failed real renderer becomes recovery UI.
// Scene inputs are props; no application React contexts cross this R3F root.
export function ViewportCanvas({
  children,
  createRenderer,
  onGraphicsFailure,
  onCreated,
}: ViewportCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<ReconcilerRoot<HTMLCanvasElement> | null>(null);
  const contentRef = useRef(children);
  const onCreatedRef = useRef(onCreated);
  const [sceneError, setSceneError] = useState<{ error: unknown } | null>(null);

  useLayoutEffect(() => {
    contentRef.current = children;
    onCreatedRef.current = onCreated;
    rootRef.current?.render(
      <SceneErrorBoundary onError={(error) => setSceneError({ error })}>
        <Suspense fallback={null}>{children}</Suspense>
      </SceneErrorBoundary>,
    );
  }, [children, onCreated]);

  useLayoutEffect(() => {
    const host = hostRef.current!;
    // A fresh canvas also isolates Strict Mode replay from R3F's deferred disposal.
    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    host.appendChild(canvas);
    const root = createRoot(canvas);
    let disposed = false;
    let failed = false;
    let configured = false;
    let configuration = Promise.resolve();

    const configure = () => {
      configuration = configuration.then(async () => {
        if (disposed || failed) return;
        const { width, height, top, left } = host.getBoundingClientRect();
        if (width === 0 || height === 0) return;
        try {
          await root.configure({
            gl: (parameters) => {
              const renderer = createRenderer(parameters, "viewport");
              renderer.localClippingEnabled = true;
              return renderer;
            },
            events,
            frameloop: "demand",
            orthographic: true,
            camera: { near: 0.1, far: 1000, position: [14, -16, 28] },
            size: { width, height, top, left },
            onCreated: (state) => {
              if (disposed || failed) return;
              state.events.connect?.(canvas);
              onCreatedRef.current(state);
            },
          });
          if (disposed) return;
          if (!configured) {
            configured = true;
            rootRef.current = root;
            root.render(
              <SceneErrorBoundary onError={(error) => setSceneError({ error })}>
                <Suspense fallback={null}>{contentRef.current}</Suspense>
              </SceneErrorBoundary>,
            );
          }
        } catch (error) {
          failed = true;
          if (disposed) return;
          if (error instanceof WebGlInitializationError)
            onGraphicsFailure(error);
          else setSceneError({ error });
        }
      });
    };
    const observer = new ResizeObserver(configure);
    observer.observe(host);
    configure();

    return () => {
      disposed = true;
      observer.disconnect();
      rootRef.current = null;
      canvas.remove();
      // configure() may still be finishing; never render into a disposed attempt.
      void configuration.then(() => root.unmount());
    };
  }, [createRenderer, onGraphicsFailure]);

  if (sceneError) throw sceneError.error;
  return <div ref={hostRef} className="h-full w-full" />;
}

class SceneErrorBoundary extends Component<
  PropsWithChildren<{ onError: (error: unknown) => void }>,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
