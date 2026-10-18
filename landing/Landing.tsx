import { Suspense, lazy, useState, type CSSProperties } from "react";
import { Button, MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import { workbenchTheme, workbenchShellTokens } from "@/theme/workbench-theme";
import { nativeModels, type ModelId } from "./model-assets";
import "./style.css";

const ModelScene = lazy(() =>
  import("./ModelScene").then((m) => ({ default: m.ModelScene })),
);
const projects: {
  id: ModelId;
  name: string;
  type: string;
  dimension: string;
}[] = [
  {
    id: "bracket",
    name: "Angle bracket",
    type: "A small part. A proper fit.",
    dimension: nativeModels.bracket.dimensions.split(" · ")[0],
  },
  {
    id: "wheel",
    name: "Control wheel",
    type: "A little more hands-on.",
    dimension: nativeModels.wheel.dimensions.split(" · ")[0],
  },
  {
    id: "enclosure",
    name: "Project enclosure",
    type: "Give your next build a home.",
    dimension: nativeModels.enclosure.dimensions.split(" · ")[0],
  },
];
function Icon({
  kind = "arrow",
  size = 18,
}: {
  kind?:
    | "arrow"
    | "left"
    | "right"
    | "cube"
    | "expand"
    | "rotate"
    | "check"
    | "github"
    | "external";
  size?: number;
}) {
  const paths = {
    arrow: "M5 12h14m-6-6 6 6-6 6",
    left: "m14 6-6 6 6 6",
    right: "m10 6 6 6-6 6",
    cube: "m12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8m-9 5v9",
    expand: "M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6",
    rotate: "M20 11a8 8 0 1 0-2 7M20 4v7h-7",
    check: "m5 12 4 4L19 6",
    external:
      "M15 3h6v6m0-6L10 14M9 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
    // Same GitHub mark used by CADara in public/icons/GitHub-logo.svg.
    github:
      "M10.0083 0C4.474 0 0 4.507 0 10.0826c0 4.457 2.8666 8.2297 6.8434 9.565.4972.1004.6793-.217.6793-.4839 0-.2337-.0164-1.0349-.0164-1.8698-2.784.6011-3.3638-1.2019-3.3638-1.2019-.4474-1.1685-1.1103-1.4688-1.1103-1.4688-.9113-.6177.0663-.6177.0663-.6177 1.0108.0668 1.5412 1.035 1.5412 1.035.8946 1.5356 2.3362 1.1017 2.9162.8346.0827-.6511.348-1.1018.6297-1.3521-2.2205-.2337-4.5567-1.1017-4.5567-4.9746 0-1.1018.3974-2.0032 1.0272-2.7042-.0994-.2503-.4474-1.2855.0995-2.671 0 0 .845-.2671 2.7505 1.035a9.622 9.622 0 012.5022-.334c.845 0 1.7065.117 2.5019.334 1.9057-1.3021 2.7507-1.035 2.7507-1.035.547 1.3855.1987 2.4207.0994 2.671.6463.701 1.0273 1.6024 1.0273 2.7042 0 3.8729-2.3362 4.7241-4.5733 4.9746.3647.3171.6793.918.6793 1.8696 0 1.352-.0163 2.4372-.0163 2.7709 0 .2671.1823.5845.6793.4843C17.1333 18.3121 20 14.5396 20 10.0826 20.0163 4.5069 15.526 0 10.0083 0z",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox={kind === "github" ? "0 0 20 20" : "0 0 24 24"}
      fill={kind === "github" ? "currentColor" : "none"}
      stroke={kind === "github" ? "none" : "currentColor"}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[kind]} fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );
}
function Header() {
  return (
    <header className="header">
      <a className="brand" href="/" aria-label="CADara landing">
        <span className="brand-mark">C</span>
        <span>CADara</span>
      </a>
      <nav aria-label="Main navigation">
        <Button
          component="a"
          href="https://github.com/dzervas/cadara"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub repository (opens in a new tab)"
          className="nav-github"
          variant="subtle"
          leftSection={<Icon kind="github" size={16} />}
          rightSection={<Icon kind="external" size={14} />}
        >
          GitHub
        </Button>
        <Button
          component="a"
          href="/app"
          className="nav-launch"
          variant="default"
          rightSection={<Icon />}
        >
          Launch CADara
        </Button>
      </nav>
    </header>
  );
}
function Scene({
  model,
  wireframe = false,
  exploded = false,
}: {
  model: ModelId;
  wireframe?: boolean;
  exploded?: boolean;
}) {
  return (
    <div
      className="scene"
      role="img"
      aria-label={`Interactive CADara model of ${projects.find((p) => p.id === model)?.name}. Drag to rotate.`}
    >
      <Suspense
        fallback={<div className="scene-loading">Preparing the model…</div>}
      >
        <ModelScene model={model} wireframe={wireframe} exploded={exploded} />
      </Suspense>
    </div>
  );
}
function OpenButton({
  model,
  label = "Open this design",
  subtle = false,
}: {
  model: ModelId;
  label?: string;
  subtle?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open() {
    setError(null);
    setLoading(true);
    try {
      const { openExample } = await import("./open-example");
      await openExample(model);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not open the example. Try again.",
      );
      setLoading(false);
    }
  }
  return (
    <div className="open-action">
      <Button
        onClick={open}
        loading={loading}
        variant={subtle ? "subtle" : "filled"}
        className={subtle ? "text-cta" : "primary-cta"}
        rightSection={<Icon />}
      >
        {label}
      </Button>
      {error && (
        <p className="launch-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
function Footer() {
  return (
    <footer className="footer">
      <span>CADara · Open-source parametric CAD</span>
      <span>Native CADara models · built with the CLI</span>
      <span>AGPL-3.0</span>
    </footer>
  );
}
function PartsCollection() {
  return (
    <div className="page collection">
      <Header />
      <main>
        <section className="collection-intro">
          <h1>
            Good things
            <br />
            start with a part.
          </h1>
          <div>
            <p>
              Parametric CAD, right in your browser. Pick a part, pull it apart,
              and make it yours.
            </p>
            <p>Connected or offline. Hands-on or scripted.</p>
            <Button
              component="a"
              href="/app"
              className="primary-cta"
              rightSection={<Icon />}
            >
              Or start with a blank canvas
            </Button>
          </div>
        </section>
        <section
          className="collection-gallery"
          id="examples"
          aria-label="Open an example design"
        >
          {projects.map((p, i) => (
            <article key={p.id} className={`collection-piece piece-${i}`}>
              <div className="piece-top">
                <span>{p.name}</span>
                <Icon kind="cube" size={18} />
              </div>
              <div className="piece-scene">
                <Scene model={p.id} />
                <span className="piece-dimension">{p.dimension}</span>
              </div>
              <div className="piece-bottom">
                <p>{p.type}</p>
                <OpenButton model={p.id} label="Make it yours" subtle />
              </div>
            </article>
          ))}
        </section>
        <section className="collection-statement" id="details">
          <div>
            <h2>In your browser.</h2>
            <p>
              Open a tab. Make a real part. Parametric sketches and solid
              modeling, without a desktop CAD install.
            </p>
          </div>
          <div>
            <h2>Offline, too.</h2>
            <p>
              Load it once, then keep making without a connection. Your modeling
              runs on your machine.
            </p>
          </div>
          <div>
            <h2>CLI now. MCP next.</h2>
            <p>
              Script your modeling workflow with the CLI. MCP access is planned
              for agent-driven workflows.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

export function Landing() {
  return (
    <MantineProvider theme={workbenchTheme} forceColorScheme="dark">
      <div
        style={{ "--spark": workbenchShellTokens.sparkAccent } as CSSProperties}
      >
        <PartsCollection />
      </div>
    </MantineProvider>
  );
}
