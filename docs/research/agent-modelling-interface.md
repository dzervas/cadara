# Agent-facing modelling interface: Blender, CAD benchmarks, and what CADara should expose

Research for bead `cadara-uio`, consulted 2026-10-18. This is an evidence-backed recommendation, not an implementation spec. Scope approval is still the user's decision.

Evidence labels used below:

- **[V]** verified against a primary source (repository code, official docs, paper text) on 2026-10-18.
- **[S]** secondary source (a paper or article summarising someone else's work).
- **[I]** inference or judgement by this report. Treat it as a hypothesis.

## 1. Summary

1. **There is no "Blender interface" to be compatible with.** Agents operate Blender through one primitive: _run arbitrary `bpy` Python inside a live, stateful Blender process_. Around that primitive sit observation tools (screenshots or multi-angle renders, compact scene facts) and documentation lookup. Both the official Blender Lab MCP server and the dominant community server (`ahujasid/mcp-for-blender`, ~31.5k stars) converged on this shape [V]. The community server started with typed `create_object`/`modify_object`/`delete_object` tools and removed them in April 2025. It peaked at 25 tools and is now down to 9 model-facing tools, with `execute_blender_code` as the primary one [V].
2. **The "LLMs are trained on Blender" hypothesis is unsubstantiated.** No model card, lab post or RL-environment disclosure shows Blender-specific training [V: none found]. The plausible advantage is ordinary pre-training exposure to Python and `bpy` code, which is large but not exceptional: 13.6k `python`-tagged questions on Blender Stack Exchange and 2.2k `blender-addon` repos on GitHub [V]. The training-oriented papers report the opposite of mastery: BlenderLLM found that "existing models demonstrate significant limitations in generating accurate CAD scripts" [V]. The community MCP now collects opt-in trajectories for training [V]. That is evidence of intent, not of current advantage.
3. **CAD benchmarks are overwhelmingly CadQuery (Python).** The stated reason is to exploit pre-trained models' Python competence instead of teaching them a new command-sequence format [V: CAD-Recode, Text-to-CadQuery, CAD-Coder, CAD-Llama, Text2CAD-Bench, CADBench]. Blender benchmarks use `bpy`. No paper found compares interface languages head-to-head for frontier agents. The closest evidence is CADFS: FeatureScript matched Python-based cadrille with less data [V].
4. **The harness matters more than the language.** The strongest 2026 results come from agentic loops against a deterministic kernel API with explicit references and execution evidence, not from a particular syntax:
   - **ReliCAD:** a general coding agent, Codex (GPT-5.5, xhigh), writing against a typed _agent-ready API_ reached 98.5% validity and IoU 85.8, against 23.2 for a fine-tuned CadQuery generator [V].
   - **3DHarnessBench:** every frontier model improved with richer tool access, and explicit numeric measurements improved on images alone [V].
   - **Vision2CAD:** an ID-based reference interface cut Chamfer distance by 17–42% [V].
5. **For general agent tooling, code-over-API beats many fine-grained tool calls.** Evidence: CodeAct (up to +20% success) [V]; Anthropic's code-execution-with-MCP post (150k → 2k tokens in their example) [V]; Cloudflare Code Mode (agents handle more and more complex tools when they are presented as a TypeScript API) [V]. The cost is that a sandbox becomes mandatory [V].
6. **Recommendation [I]:** keep the existing `SemanticSession` as the one shared core. Add a **typed TypeScript SDK** over it and a **persistent, sandboxed modelling runtime** that hosts that SDK. Expose the runtime through a _small_ MCP surface:
   - run a script
   - inspect compactly
   - look (rendered views)
   - search docs and schema
   - save/export (possibly folded into scripts)

   Keep CLI recipes as the batch/CI/human path and as the reproducible trace format. Add WebMCP later as a second host for the same runtime against the live browser document. Do **not** mimic `bpy` names: the thing to copy from Blender is the _shape of the loop_ (live session + code + observe), not its API. The biggest current gap is **visual observation**. Every successful system has it, and the CLI has none.

## 2. Method and limitations

- Primary sources were read directly:
  - shallow, then full, clones of `ahujasid/mcp-for-blender` and `projects.blender.org/lab/blender_mcp`, including git history
  - arXiv abstracts and HTML full text (via the arXiv API)
  - official Blender, Anthropic, Cloudflare, Chrome, W3C CG, MCP, Zoo, Onshape and Autodesk pages
  - GitHub and Stack Exchange APIs for popularity proxies
- The planned parallel research subagents failed at launch because the vresto MCP server was not available to children (`Unresolved MCP direct-tool selectors: vresto`). vresto's `research` tier `big` is not configured (`research_model_not_configured`), and the `small` tier timed out or hit a full queue. All research was therefore done in the parent session with vresto search/fetch plus direct primary-source downloads.
- Not done: realistic modelling trials comparing interfaces on CADara. Section 9 proposes the protocol; this is the main remaining evidence gap.
- Popularity counts are crude proxies for training exposure, not measurements of it.

## 3. How agents operate Blender today

### 3.1 The API being driven: `bpy`

- `bpy.ops` operators are context-, mode- and selection-dependent. `bpy.data`/`bmesh` are the precise data APIs [V: Blender API "Gotchas" sections on operators and on modes and mesh access]. The official Lab MCP's system prompt is essentially a list of these pitfalls [V: `mcp/blmcp/data/prompts.yml`]:
  - "wrong mode either fails or silently does nothing"
  - active object vs selection must be re-set between operator calls
  - update the depsgraph before reading computed properties
  - flush `bmesh` edits or "silently loses all edits"
  - "Return structured data … not print output"
  - "Blender defaults to meters"
- The API breaks between major versions. For example, 4.0 removed `MeshEdge.bevel_weight`/`crease` in favour of generic attributes and renamed asset APIs [V: 4.0 Python API release notes]. Version drift is a standing source of hallucinated calls [I, consistent with LL3M bundling a Blender-docs RAG and Blender Lab bundling API RST docs plus a `search_api_docs` tool].
- Headless: `blender -b --python …` works, and `bpy` is also a pip module (5.2.2 on PyPI) [V]. In the pip module:
  - only one `.blend` is editable per process
  - `importlib.reload` is unsupported
  - it starts with the default cube scene
  - CLI-only options are unavailable [V]

### 3.2 Official: Blender Lab MCP server (2026)

[V: blender.org/lab/mcp-server and the `blender_mcp` repo, last commit 2026-09-29]

- It needs Blender 5.1+. The architecture is `MCP client ⇐stdio⇒ blender-mcp ⇐TCP⇒ Blender add-on`, described as "deliberately small, maintainable, and does no more than necessary".
- Tools:
  - `execute_blender_code`, plus `execute_blender_code_for_cli` for a background Blender process
  - read-only summaries: data-blocks, missing files, linked libraries, path info, usage guess, objects, object detail
  - screenshots: an area or the window as PNG, and the window layout as JSON
  - navigation: jump to a tab or object
  - `render_thumbnail_to_path`, `render_viewport_to_path`
  - `get_python_api_docs`, `search_api_docs`, `search_manual_docs`
- The prompt calls `execute_blender_code` "a last resort" when another tool suffices. The showcased use cases are scene **analysis, debugging, renaming and documentation**, not modelling.
- Security warning, verbatim: it "will execute LLM generated code in Blender without any guards", so it recommends a VM.
- 3DHarnessBench (Sept 2026) used this server, v1.0.0, as its harness [V].

### 3.3 Community: `ahujasid/mcp-for-blender` (formerly `blender-mcp`)

[V: repository README, `server.py` and git history]

- About 31.5k GitHub stars. Last push 2026-10-18.
- Tool-surface history, from git:

  | Date               | Tools          | Notes                                                                                                                        |
  | ------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
  | 2025-03-07         | 7              | `create_object`, `modify_object`, `delete_object`, `set_material`, `render_scene`, `execute_blender_code`, `create_3d_scene` |
  | 2025-04-03         | —              | commit `e0e8095`: "removed create, delete, modify functions"                                                                 |
  | 2025-03 to 2025-08 | ~17            |                                                                                                                              |
  | 2026-08            | 25             |                                                                                                                              |
  | 2026-09-30         | 9 model-facing | commit `b704265`: "simplify tools and add guides"; the 2026-10-05 tree has 14 `@mcp.tool` registrations, some app-only       |

- The README now states: "The AI writes Blender Python itself for modelling, layout, materials, animation, rigging and retopology. The MCP adds what Python can't do on its own".
- Code comment: "Each tool covers a job the model can't do with execute_blender_code alone: seeing the scene (look), paid and keyed services …, and craft knowledge it loads only when needed".
- Craft "guides" are currently **switched off "while evals measure what the model does without them"**.
- Observation tools:
  - `look` gives viewport, camera, auto-framed multi-angle sheets and animation strips, in solid/material/rendered/wireframe/xray shading. Its `max_size` defaults to 768 px with a note that "images stay in the conversation, so go smaller for quick checks".
  - `get_scene_info` returns one line per object, with selectable fields such as placement, size, ground contact, topology health (non-manifold edges, ngons), rig weights and settings.
- Safety: arbitrary code execution is "the product feature, so by default nothing is validated". An opt-in AST allow-list (`BLENDER_MCP_SAFE_MODE`) targets prompt injection. It is explicitly "not a sandbox around Blender", because the socket accepts raw code from any local process.
- Data: opt-in telemetry collects trajectories (goals, actions, before/after scene state, accept/reject/correction feedback). The terms license this "for AI training, research, open datasets".

### 3.4 What this means

- [V] Both mature Blender integrations are _live-session + code execution + observation + docs_. Neither offers a typed modelling vocabulary. The community one tried a typed vocabulary first and removed it.
- [I] This works for Blender because it is a mesh/scene editor with an enormous, stable-enough scripting API and no notion of durable design intent. Mistakes are visible and cheap to undo, and "correct" is mostly visual. Parametric B-rep CAD has a stricter correctness notion: exact dimensions, constraints, editable history and stable references. That changes what the loop's _observations_ must contain, not the loop itself.

## 4. The training-advantage hypothesis

- No primary evidence was found that any frontier lab trained or post-trained specifically on Blender: no model card, release post or RL-environment disclosure. Searches turned up generic RL-environment vendors and hobby "RL with Blender" repos only [V: absence in search; absence is not proof].
- Exposure proxies, collected 2026-10-18 [V]:

  | Proxy                               | Count  |
  | ----------------------------------- | ------ |
  | Blender Stack Exchange `python` tag | 13,632 |
  | Stack Overflow `python`             | 2.2M   |
  | Stack Overflow `openscad`           | 195    |
  | Stack Overflow `freecad`            | 81     |
  | Stack Overflow `cadquery`           | 15     |
  | GitHub topic `blender`              | 6,676  |
  | GitHub topic `blender-addon`        | 2,260  |
  | GitHub topic `openscad`             | 1,311  |
  | GitHub topic `freecad`              | 990    |
  | GitHub topic `opencascade`          | 291    |
  | GitHub topic `build123d`            | 260    |
  | GitHub topic `cadquery`             | 252    |
  | GitHub topic `jscad`                | 44     |
  | GitHub topic `replicad`             | 9      |
  | GitHub topic `featurescript`        | 6      |

  Blender scripting is among the best-represented 3D APIs, but every CAD-specific API, Python or TypeScript, is tiny next to general Python/TypeScript.

- Counter-evidence: BlenderLLM (Dec 2024) found existing models weak at Blender CAD scripts and fine-tuned on its own BlendNet dataset of 12k samples [V]. BlenderGym found state-of-the-art VLM systems "struggle with tasks relatively easy for human Blender users" [V]. LEGO-Anything (Sept 2026) reports the best agent at 53.4% indoor and 39.6% outdoor, with failure modes of weak initialisation, regressive edits and unreliable self-evaluation [V].
- Conclusion [I]: models are good at _Python_ and good at _driving code loops_. They are not demonstrably special at Blender. A CADara API that is idiomatic in a mainstream language gets most of the available prior. Copying `bpy` naming would import Blender's semantics (meters, mode/selection state, mesh-centric data) into a parametric CAD tool, and the hypothesis gives no evidence of a benefit.

## 5. Papers and benchmarks: which interface they use

| Work (arXiv, date)                                  | Interface                                                                                               | Loop                               | Feedback                                              | Headline [V unless noted]                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 3D-GPT 2310.12945 (2023-10)                         | Blender procedural params via agents                                                                    | multi-agent                        | —                                                     | qualitative                                                                                                |
| 3D-PreMise 2401.06437 (2024-01)                     | program synthesis driving 3D software                                                                   | self-correct                       | visual interface                                      | potential and limits of self-correction                                                                    |
| SceneCraft 2403.01248 (2024-03)                     | `bpy`                                                                                                   | iterative                          | rendered images (GPT-V) + library learning            | beats prior LLM agents on constraint adherence                                                             |
| BlenderAlchemy 2404.17672 (2024-04)                 | Blender edit sequences                                                                                  | search                             | VLM visual evaluator                                  | simple-but-tedious edits                                                                                   |
| Query2CAD 2406.00144 (2024-05)                      | FreeCAD macros                                                                                          | self-refine                        | BLIP2 + human                                         | GPT-4T 53.6% first try, +23.1% with refinement, most from the first iteration                              |
| Text2CAD 2409.17106 (2024-09)                       | DeepCAD sketch-extrude sequences                                                                        | one-shot                           | —                                                     | transformer from scratch                                                                                   |
| CADCodeVerify / CADPrompt 2410.05340 (2024-10)      | CadQuery                                                                                                | iterative                          | VLM-generated validation questions on renders         | GPT-4: −7.3% point-cloud distance, +5.0% success                                                           |
| CAD-MLLM 2411.04954 (2024-11)                       | command sequences                                                                                       | one-shot                           | —                                                     | multimodal conditioning                                                                                    |
| BlenderLLM / CADBench (2024) 2412.14203             | `bpy`                                                                                                   | self-improvement fine-tune         | —                                                     | existing models weak at Blender CAD scripts                                                                |
| CAD-Recode 2412.14042 (2024-12)                     | CadQuery-style Python                                                                                   | one-shot                           | —                                                     | "taking advantage of the exposure of pre-trained LLMs to Python code"                                      |
| CAD-Assistant 2412.13810 (2024-12)                  | FreeCAD Python API in an interpreter                                                                    | iterative tool use                 | renders, cross-sections, sketch parameteriser         | beats VLM baselines                                                                                        |
| CADFusion 2501.19054 (2025-01)                      | parametric sequences                                                                                    | training                           | visual-preference reward                              | improves over sequence-only                                                                                |
| BlenderGym 2504.01786 (2025-04)                     | `bpy` edits                                                                                             | inference scaling                  | verifier                                              | verifier scaling helps; SOTA still weak                                                                    |
| CAD-Llama 2505.04481 (2025-05)                      | code-like "SPCC"                                                                                        | training                           | —                                                     | models "neither encounter parametric sequences during pretraining"                                         |
| Text-to-CadQuery 2505.06507 (2025-05)               | CadQuery                                                                                                | one-shot fine-tune                 | —                                                     | exact match 58.8→69.3%, CD −48.6%, scales with size                                                        |
| CAD-Coder (Doris) 2505.14646 (2025-05)              | CadQuery from images                                                                                    | one-shot                           | —                                                     | 100% valid syntax                                                                                          |
| CAD-Coder (Guan) 2505.19713 (2025-05)               | CadQuery                                                                                                | SFT + GRPO                         | Chamfer reward                                        | "seamless integration with existing LLMs"                                                                  |
| cadrille 2505.22914 (2025-05)                       | Python CAD                                                                                              | SFT + online RL                    | programmatic                                          | RL > offline                                                                                               |
| LL3M 2508.08228 (2025-08)                           | `bpy` (bmesh, modifiers, shader nodes)                                                                  | multi-agent write/debug/refine     | code + visual self-critique, BlenderRAG               | qualitative                                                                                                |
| CAD-RL / ExeCAD 2508.10118 (2025-08)                | CadQuery                                                                                                | RL                                 | executability + geometry rewards                      | —                                                                                                          |
| MeshCoder 2508.14879 (2025-08)                      | custom `bpy` API library                                                                                | one-shot                           | —                                                     | expressive custom API + large dataset                                                                      |
| EvoCAD 2510.11631 (2025-10)                         | CadQuery (CADPrompt)                                                                                    | evolutionary                       | VLM                                                   | topology metrics                                                                                           |
| VIGA / BlenderBench 2601.11109 (2026-01)            | `bpy`                                                                                                   | code-render-inspect loop           | renders + memory                                      | +35% on BlenderGym vs one-shot                                                                             |
| ProCAD 2602.03045 (2026-02)                         | CadQuery                                                                                                | clarify, then code                 | —                                                     | vs Claude Sonnet 4.5: CD −79.9%, invalidity 4.8→0.9%                                                       |
| AADvark 2604.15184 (2026-04)                        | FreeCAD + assembly solver                                                                               | iterative                          | visual + solver                                       | first moving assemblies                                                                                    |
| CADFS 2605.01925 (2026-05)                          | **FeatureScript**                                                                                       | fine-tune                          | —                                                     | FeatureScript ≈ Python cadrille with less data; representation ablations matter                            |
| CADBench (2026) 2605.10873                          | CadQuery                                                                                                | one-shot                           | —                                                     | specialised mesh-to-CAD ≫ code-generating VLMs                                                             |
| Text2CAD-Bench 2605.18430 (2026-05)                 | CadQuery                                                                                                | retries with error feedback        | execution errors                                      | GPT-5.2 invalidity 11% (L1) → 68% (L3)                                                                     |
| Embodied CAD 2606.31252 (2026-06)                   | typed skill library → FreeCAD                                                                           | step-wise                          | solver feedback                                       | "does not ask the model to emit an entire CAD program in one pass"                                         |
| RA-CAD 2608.05714 (2026-08)                         | CAD code                                                                                                | generate-execute-critique-rewrite  | execution observation                                 | SOTA validity                                                                                              |
| 3DHarnessBench 2609.06535 (2026-09)                 | `bpy` via Blender Lab MCP                                                                               | 4 harness levels                   | screenshots → full 3D interaction                     | all models improve with richer access; explicit measurements help                                          |
| CIT-CAD 2609.07434 (2026-09)                        | CAD code                                                                                                | verify/repair                      | extracted constraints vs intent tree                  | geometry metrics miss construction errors                                                                  |
| BVB 2609.15478 (2026-09)                            | `bpy` in a harness/sandbox                                                                              | agentic                            | renders                                               | best 53.7% fact retention                                                                                  |
| Vision2CAD 2609.22688 (2026-09)                     | **ID-based kernel ops**                                                                                 | agentic                            | execution verification                                | mIoU +11.1/+5.6%, CD −17.3/−41.8%                                                                          |
| ReliCAD 2609.22325 (2026-09)                        | **typed "Agent-ready API"** (create_sketch, add_line, extrude, fillet, get_entity_info, export_step, …) | plan → execute → evidence → repair | runtime evidence                                      | validity 99.8%, IoU 87.5; Codex-5.5 on the same API 98.5% / 85.8                                           |
| LEGO-Anything 2609.36380 (2026-09)                  | `bpy` via Blender MCP                                                                                   | agentic                            | renders + deterministic signals                       | plugin up to +62.7%; "refinement should be grounded in deterministic evidence rather than self-assessment" |
| CADForge 2610.04262, CADFather 2610.09127 (2026-10) | CadQuery / CAD programs + tools                                                                         | agentic                            | review agent, render inspection, numeric optimisation | beat baselines                                                                                             |

Answers to the four sub-questions:

- **(a) Dominant representation.** CadQuery for CAD and `bpy` for Blender [V]. The papers justify this by pre-trained Python competence and executability [V: CAD-Recode, Text-to-CadQuery, CAD-Coder, CAD-Llama, Text2CAD-Bench related work]. Benchmarks pick it because it is runnable and scorable offline (Chamfer distance, IoU, invalidity rate). That is a _benchmark convenience_ and not necessarily the best _product_ interface [I].
- **(b) Direct comparisons.**
  - CADFS isolates representation (FeatureScript vs Python cadrille) and finds FeatureScript viable with less data [V].
  - Text2CAD-Bench cites LLM4CAD as finding text-only input better than image or multimodal input for CadQuery [S].
  - No study found compares CadQuery vs OpenSCAD vs a typed API for frontier _agents_.
  - ReliCAD's Codex baseline is the nearest proxy: a frontier agent writing code against a typed kernel API vastly outperforms fine-tuned free-form CadQuery generators. The conditions differ (agentic vs one-shot), so read it as harness+API vs one-shot code [V for numbers, I for interpretation].
- **(c) Feedback.** Every agentic paper reports gains from execution and/or visual feedback [V]:
  - Query2CAD +23.1%
  - CADCodeVerify +5% success
  - VIGA +35%
  - 3DHarnessBench monotone with access
  - LEGO-Plugin up to +62.7%

  Diminishing returns after the first iteration and unreliable self-judgement are repeated findings [V: Query2CAD, LEGO-Anything]. Deterministic geometric evidence (measurements, constraint extraction, solver state) beats self-assessment [V: LEGO-Anything, CIT-CAD, ReliCAD, 3DHarnessBench measurement ablation].

- **(d) Fine-tuning vs prompting.** Fine-tuned small models beat prompted frontier models on _in-distribution one-shot_ benchmarks (ProCAD, Text-to-CadQuery, CAD-Coder) [V]. Agentic frontier models with good tools beat fine-tuned one-shot generators on harder or complex sets (ReliCAD) [V]. CADara cannot fine-tune vendor models, so the lever it controls is the harness and API [I].

## 6. How other CAD tools expose themselves to agents

| Product              | Surface                                                                                                                                                         | Shape [V]                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zoo (KittyCAD)       | KCL, a first-class text CAD language, plus the Zookeeper agent (Jan 2026)                                                                                       | KCL is "the definition of geometry and design intent". Zookeeper writes, executes and debugs KCL, "frequently executes the model to check for errors, and … reviews the geometry via multi-view snapshots", plus computational tools (mass, centre of mass, area, volume). Zoo moved _away_ from direct text-to-B-rep toward code because of LLM coding ability. |
| Onshape (PTC)        | FeatureScript MCP Server (Onshape Labs, remote HTTP)                                                                                                            | AI can "generate FeatureScript, insert it into an Onshape document, run it, evaluate the results, identify errors, and revise the code". Positioned as "text-to-code-to-CAD". Community `onshape-mcp` servers expose up to 87 fine-grained REST tools.                                                                                                           |
| Autodesk Fusion      | Official local Fusion MCP Server (Streamable HTTP, live session, desktop only) plus a remote Fusion Data MCP                                                    | Tools are "discovered … at connection time and may change", actions are session-based, and the Assistant has "prompt to API" access to "almost all Fusion functionality".                                                                                                                                                                                        |
| FreeCAD              | Community MCP servers, e.g. `neka-nat/freecad-mcp` ("Create and edit models, run Python scripts, inspect documents"), and a "Robust MCP Server" with 150+ tools | Mix of run-Python and very wide fine-grained tool sets.                                                                                                                                                                                                                                                                                                          |
| CadQuery / build123d | Community MCP servers (`mcp-cadquery` executes scripts; `build123d-mcp` "give your AI CAD eyes")                                                                | Code execution + rendering.                                                                                                                                                                                                                                                                                                                                      |

Pattern [I]: the vendors with a native language (Zoo/KCL, Onshape/FeatureScript) give the agent _that language plus execute plus observe_. Fusion exposes a live-session tool surface over its full API. Nobody ships a fixed JSON batch format as the primary agent surface.

## 7. General agent-interface evidence

- **CodeAct** (Wang et al. 2024, 2402.01030): code actions vs JSON/text tool calls across 17 LLMs, "up to 20% higher success rate" [V].
- **Anthropic, "Code execution with MCP"** (2025-11-04):
  - presenting MCP tools as a code API that the agent imports on demand reduced an example "from 150,000 tokens to 2,000 tokens—a time and cost saving of 98.7%"
  - intermediate data stays out of context
  - state can persist in files
  - but "running agent-generated code requires a secure execution environment with appropriate sandboxing, resource limits, and monitoring" [V]
- **Cloudflare, "Code Mode"** [V]:
  - "agents are able to handle many more tools, and more complex tools, when those tools are presented as a TypeScript API rather than directly"
  - LLMs "have seen a lot of code. They have not seen a lot of 'tool calls'"
  - the sandbox is a V8 isolate with no internet, whose only access is the bound APIs
- **Anthropic, "Writing effective tools for agents"** (2025-09-11) [V]:
  - consolidate frequently chained operations
  - return high-signal fields and natural-language identifiers over cryptic IDs
  - paginate/truncate (Claude Code caps tool responses at 25,000 tokens by default)
  - evaluate tools with agents
- **SWE-agent** (2405.15793): "interface design affects the performance of language model agents". A purpose-built agent-computer interface beat raw shells [V].
- **MCP spec:** current protocol version 2026-07-28 [V].
- **WebMCP:**
  - Draft Community Group Report, 16 Oct 2026, "not a W3C Standard nor … on the W3C Standards Track" [V]
  - Chrome: origin trial from Chrome 149, plus `chrome://flags/#enable-webmcp-testing` [V]
  - tools are registered from page JavaScript with JSON Schema inputs and execute visibly in the page [V]
  - it lets an agent _in the browser_ act on the user's live document; it is not a substitute for an external MCP server [V/I]
- **Language prior [I]:** for CADara, TypeScript is the native language of the app, the browser and Bun. It has a huge general training prior but a tiny _CAD-library_ prior (replicad 704 stars; `jscad` topic 44). Python has CadQuery's small but benchmark-dominant prior. Because CADara's semantics are its own either way, the language matters mainly for general idiom fluency and type-driven self-correction. Both favour TypeScript in this codebase. No benchmark found measures `.d.ts`-guided SDK use directly.

## 8. CADara today, against this evidence

What exists [V: repository]:

- `SemanticSession.execute(SemanticCommand)` is a recipe- and terminal-independent application API with serial execution, cancellation, truthful terminal results and a close contract (`src/application/semantic/ports.ts`). `createHeadlessSessionFactory` composes it over OCC/filesystem (`src/composition/headless.ts`).
- The CLI recipe runner is a thin sequential adapter over it (`src/cli/commands/document-recipes.ts` calls `session.execute`).
- The closed operation set covers 87 operations across documents, sketches, requirements and dimensions, variables, history, features, booleans, patterns, holes, sweeps, lofts and exports (`src/cli/COVERAGE.md`). There are 85 distinct `operation:` literals in `src/contracts/semantic/schema.ts`.
- Discovery is already structured and agent-oriented: labelled references, bounds, face topology, receipts, `--schema` and `--help`, structured selection errors with candidates, and compact output (`.agents/skills/cadara-cli-modelling/SKILL.md`).

Where the batch-recipe _encoding_ fights the agent loop [V for facts, I for diagnosis]:

| Problem                                                    | Evidence                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bookkeeping overhead                                       | The qualified L-bracket (two rectangles, two extrudes, edit, rename, save, reopen, 2 exports) is 15 operations and 5,064 bytes of JSON (`src/cli/examples/multi-sketch-part.json`). Every step carries `commandId`, `as`, `basis` and `draft` aliases. An idiomatic code API expresses the same intent with local variables.                         |
| No live session                                            | Each invocation owns one private document; processes share only saved files. Packaged native opens of public samples take about 8/19/44 s, and restoration is ~92.5% of enclosure cost (cadara-3sq). An agent iterating through separate CLI calls pays reconstruction repeatedly. That is why cadara-3sq.6 (cross-process checkpoint cache) exists. |
| Discovery-dependent continuation needs save/reopen staging | Geometry-dependent selection needs references from a previous result's discovery, so the skill prescribes save → inspect → reopen in a continuation recipe. In a persistent session the agent would simply read the result and continue.                                                                                                             |
| Output volume                                              | Detailed discovery is "often 20–40 KB" per result. Compact mode exists, but the agent cannot query just what it needs; code could filter in-runtime (the Code Mode / code-execution-with-MCP argument).                                                                                                                                              |
| No visual observation                                      | "The CLI has no browser, renderer or PNG export dependency." Every successful system in sections 3, 5 and 6 includes rendered views; 3DHarnessBench and LEGO-Anything show that observation access drives results.                                                                                                                                   |

What CADara already does _better_ than Blender-style code execution [V/I]:

- **Typed, closed, validated operations with truthful receipts.** ReliCAD, Embodied CAD and Vision2CAD are research systems _building_ exactly this (an agent-ready API, typed operations, ID-based references, runtime evidence) and attributing their gains to it.
- **Durable references and design-intent features** (variables, constraints, dimensions). CIT-CAD argues geometry-only metrics miss these; free-form CadQuery or `bpy` does not have them at all.
- **Refusals instead of silent wrong results.** This directly addresses the `bpy` "silently does nothing" class of failures.

So the semantic layer is the asset. The one-shot JSON batch is the liability.

## 9. Options

Scored against the bead's criteria. ++ strong, + good, 0 neutral, − weak. All [I].

| Criterion                | CLI recipes (today)                    | Fine-grained MCP tools (one per op)                    | TS SDK only (agent writes `cadara run x.ts`) | **Persistent runtime: SDK + sandbox, small MCP surface**                    | WebMCP in-page                     |
| ------------------------ | -------------------------------------- | ------------------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------- |
| Usability / idiom        | − alias bookkeeping                    | 0                                                      | ++                                           | ++                                                                          | +                                  |
| Token cost               | − verbose input, large output          | − ~85 schemas in context, every result through context | +                                            | ++ load docs/types on demand, filter in-runtime                             | +                                  |
| Discovery                | + `--schema`                           | +                                                      | + `.d.ts`, docs                              | ++ types + `search_docs` + schema                                           | +                                  |
| Typing / validation      | ++ Typia                               | ++                                                     | ++ compile-time + Typia at execute           | ++                                                                          | ++                                 |
| Stable references        | + labels/aliases (snapshot only)       | +                                                      | ++ handles in variables                      | ++                                                                          | ++                                 |
| Transactions / revisions | ++ basis/draft                         | ++                                                     | ++ same core                                 | ++ same core                                                                | ++                                 |
| Failure recovery         | − stop-at-first-failure, re-run prefix | +                                                      | 0 per process                                | ++ fix and continue in session                                              | +                                  |
| Persistence / export     | ++                                     | ++                                                     | ++                                           | ++                                                                          | + via app                          |
| Cold start / replay cost | − per invocation (3sq)                 | ++ if server persistent                                | − per invocation                             | ++ one open per session                                                     | ++                                 |
| Visual feedback          | − none                                 | needs renderer                                         | needs renderer                               | needs renderer (`look`)                                                     | ++ live viewport                   |
| Safety                   | ++ data only                           | ++ data only                                           | − runs agent code                            | 0 needs a real sandbox                                                      | + browser permissions/confirmation |
| Browser vs headless      | headless                               | headless                                               | headless                                     | both, if the runtime is host-agnostic                                       | browser                            |
| Packaging                | ++ exists                              | +                                                      | +                                            | 0 new host                                                                  | − draft standard, Chrome OT        |
| Reproducibility          | ++ the recipe is the trace             | + log                                                  | 0 script may be nondeterministic             | + if the runtime records the executed `SemanticCommand` trace _as a recipe_ | 0                                  |

## 10. Recommendation

All of this section is [I] and needs a user decision.

1. **One core, many thin adapters.** `SemanticSession` stays the single contract. No adapter gets its own modelling semantics; this also keeps WebMCP (cadara-ekb) from becoming a second API.
2. **A typed TypeScript SDK** generated from or wrapping the semantic contracts:
   - result handles replace aliases
   - `basis`/`draft` chaining is implicit in the handle
   - typed refusals become returned results, never swallowed exceptions (per AGENTS.md)
   - CADara's names, units and semantics are kept

   Illustrative only, not a spec:

   ```ts
   const doc = await cadara.document.create({ label: "L bracket" });
   const base = await doc.sketch("xy", (s) => s.rectangle([0, 0], [40, 20]));
   const plate = await doc.extrude(base.region("Outer region"), { depth: 4 });
   const wall = await doc.sketch("yz", (s) => s.rectangle([0, 0], [20, 30]));
   await doc.extrude(wall.region("Outer region"), {
     depth: 4,
     join: plate.body,
   });
   return doc.inspect({ bodies: ["bounds", "faceCount"] });
   ```

3. **A persistent modelling runtime** (headless Bun host first) that holds one open session and evaluates agent-supplied SDK scripts in a **real sandbox**.
   - Options to evaluate: QuickJS/isolated-vm, a worker under the user's existing sandbox wrapper, or Deno-style permissions.
   - `node:vm` is not a security boundary.
   - The only capabilities granted are the SDK bindings and an explicit workspace directory for open/save/export.
4. **A small MCP surface over the runtime**, mirroring what Blender converged on and what Code Mode argues for:
   - `run` (script, returns structured value plus receipts)
   - `inspect` (compact, field-selectable model facts: bounds, topology counts, solve status, variables)
   - `look` (rendered views: multi-angle, section, wireframe; size-capped)
   - `docs`/`schema` search

   Make the server **workspace-aware**: open/save/export target files explicitly. Do not expose ~85 per-operation tools.

5. **Record every executed `SemanticCommand` as a recipe trace.** Scripts stay exploratory, the trace stays reproducible and replayable through the existing CLI, and CI keeps its batch path.
6. **Keep CLI recipes** for batch/CI and for human one-liners. The human workflow rethink is cadara-iwf; this recommendation does not decide its grammar.
7. **Build headless rendering** for `look`. It is the largest capability gap relative to every system surveyed. Even coarse OCC-tessellated multi-view PNGs would do, as long as they are deterministic and stay labelled as non-authoritative next to exact receipts, as the skill already says of screenshots.
8. **WebMCP later**, as a second host of the same runtime against the active browser document, with confirmation for destructive operations. Its standard status (CG draft, Chrome OT) argues against making it the first adapter.
9. **Don't:**
   - mimic `bpy` names or semantics
   - expose raw internals or "eval arbitrary TS against the service"
   - make free-form code generation the source of truth instead of the semantic contract

Relationship to existing beads [I]:

- A persistent session reduces, but does not remove, the value of cadara-3sq.6. Cold opens still matter for the first open and for CI.
- cadara-iwf (CLI product) and cadara-ekb (WebMCP) should both consume the SDK/runtime contract if it is approved.

## 11. Proposed trials (next evidence gate)

The decision should rest on CADara-specific measurements, not only on literature. Protocol:

- **Tasks:** 6–10 parts of rising difficulty from the public samples plus a few new ones, e.g. plate with hole pattern, L-bracket, enclosure with vents and bosses, revolved part, parametric edit of an existing `.cadara`. Each task has an exact acceptance check: bounds, face count, variables wired, receipts written, constraint state.
- **Arms:**
  - A: current CLI + skill
  - B: thin prototype SDK run as `bun script.ts` per attempt
  - C: prototype persistent runtime with `run`/`inspect` (and `look` if a quick renderer exists)
  - each with and without images, to measure the observation effect
- **Models:** at least two frontier agents, run inside the user's sandbox wrapper.
- **Metrics:**
  - task success against the acceptance checks
  - wall time
  - input and output tokens
  - number of tool calls or invocations
  - retries
  - refusals hit
  - human-judged editability: are parameters actually wired?
- **Prototype rules:** throwaway, under `.scratch/`, no production contract changes, not committed.

## 11a. Trial results (cadara-kkl.1, 2026-10-18)

The trials ran 48 runs: 6 tasks × 4 arms (CLI recipes, SDK script per process, persistent runtime, runtime + rendered views) × 2 models (gpt-6.1-sol, claude-sonnet-5-5). An independent checker reopened every saved file through the built CLI and probed parametric edits. Prototypes and full evidence live untracked under `.pi/trials/agent-interface/` (`REPORT.md`, `results.md`).

- All 48 runs met the nominal geometry. Interface choice did not decide success.
- In the hard tier (parametric enclosure), 9 of 16 runs were fully parametric. Every failure traced to construction choices that expose kernel/naming defects (cadara-0cl, cadara-6bu) or an OCC fillet rejection, not to the interface.
- The SDK and runtime reduced context by about 25% and time by 15–20% for gpt-6.1-sol on the base tasks. Sonnet was flat across arms, and it wrote its own Python recipe generators in 4 of 6 CLI runs.
- The persistent runtime showed no measurable advantage at these model sizes (1–2 s built-CLI startup, sub-second rebuilds).
- Rendered views were opened in 9 of 12 runs and never changed a decision on fully dimensioned tasks.
- The reliability gap is self-verification: 5 of 16 hard runs claimed success while a parametric probe failed, and the false `wellConstrained` status (cadara-8kv) misled agents.

The evidence shifts emphasis from §10. The shared core plus a thin SDK is cheap and helps; the kernel durable-naming fixes, discovery/selector consistency and a built-in parametric verification aid matter more than the host. The persistent sandboxed runtime and `look` have no evidence for these tasks and remain hypotheses for large models, interactive editing and visual briefs. Limits: n = 2–4 per cell, prototype fidelity, fully dimensioned single-session tasks.

## 12. Open questions for the user

1. Is a sandboxed code runtime acceptable as the primary agent surface, given that it introduces agent-code execution where recipes are data-only? Which sandbox is preferred (your sandbox wrapper vs an in-process JS isolate)?
2. Who is the first host: headless/Bun (external agents such as Claude Code or pi) or the browser editor (WebMCP)?
3. Is headless rendering for `look` in scope, and at what fidelity?
4. Should the SDK be public and documented for humans too (scripted CAD, like replicad/CadQuery users), or remain agent-oriented?
5. Should recipes remain a first-class authoring format, or become mainly the trace/replay format?
6. Should section 11's trials run before any SDK commitment, or in parallel with a minimal SDK spike?

## 13. Sources

All accessed 2026-10-18.

Blender:

- https://www.blender.org/lab/mcp-server/
- https://projects.blender.org/lab/blender_mcp (git clone; `readme.md`, `readme_tools.rst`, `mcp/blmcp/data/prompts.yml`)
- https://github.com/ahujasid/mcp-for-blender (git clone; `README.md`, `src/blender_mcp/server.py`, `safe_mode.py`, `TERMS_AND_CONDITIONS.md`, commits `4372edf`, `e0e8095`, `b704265`, `34b7bd2`)
- https://docs.blender.org/api/current/info_advanced_blender_as_bpy.html
- https://docs.blender.org/api/current/info_gotcha.html
- https://pypi.org/project/bpy/
- https://developer.blender.org/docs/release_notes/4.0/python_api/

Papers (https://arxiv.org/abs/<id>):

- 2310.12945, 2401.06437, 2403.01248, 2404.17672, 2406.00144
- 2409.17106, 2410.05340, 2411.04954, 2412.14203, 2412.14042, 2412.13810
- 2501.19054, 2504.01786, 2505.04481, 2505.06507, 2505.14646, 2505.19713, 2505.22914
- 2508.08228, 2508.10118, 2508.14879, 2510.11631
- 2601.11109, 2602.03045, 2604.15184, 2605.01925, 2605.10873, 2605.18430
- 2606.31252, 2608.05714, 2609.06535, 2609.07434, 2609.15478, 2609.22688, 2609.22325, 2609.36380
- 2610.04262, 2610.09127
- 2402.01030 (CodeAct), 2405.15793 (SWE-agent)

Agent tooling:

- https://www.anthropic.com/engineering/code-execution-with-mcp
- https://www.anthropic.com/engineering/writing-tools-for-agents
- https://blog.cloudflare.com/code-mode/
- https://modelcontextprotocol.io/specification/versioning
- https://webmachinelearning.github.io/webmcp/
- https://developer.chrome.com/docs/ai/webmcp

CAD products:

- https://zoo.dev/research/zookeeper
- https://zoo.dev/research/introducing-kcl
- https://www.onshape.com/en/blog/featurescript-mcp-server-enables-text-code-cad
- https://help.autodesk.com/view/ADSKMCP/ENU/?guid=ADSKMCP_FusionDesktopMcp_autodesk_fusion_mcp_server_html
- https://www.engineering.com/autodesk-announces-fusion-mcp-servers-and-more-ai-updates/
- https://github.com/neka-nat/freecad-mcp
- https://github.com/bertvanbrakel/mcp-cadquery
- https://pypi.org/project/build123d-mcp/
- https://github.com/sgenoud/replicad

Popularity proxies:

- Stack Exchange API `/2.3/tags/{tag}/info`
- GitHub search API `topic:{tag}`

Repository:

- `src/application/semantic/ports.ts`
- `src/composition/headless.ts`
- `src/cli/commands/document-recipes.ts`
- `src/cli/COVERAGE.md`
- `src/cli/examples/multi-sketch-part.json`
- `.agents/skills/cadara-cli-modelling/SKILL.md`
- beads `cadara-3sq`, `cadara-iwf`, `cadara-ekb`
