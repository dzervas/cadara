# Trial task: {title}

## Task

{task text from tasks.json}

## How to work

{arm instructions from arms.json, with {BIN} replaced by the directory holding the `cadara`, `cadara-sdk` and `cadara-rt` commands}

Documents in this directory:
{one line per document listed for the arm}

## Rules

- Work only inside this directory (`{run directory}`). Use only the documents in it and the commands named above. Do not read CADara source code or any other directory.
- The deliverables are checked by an independent geometric checker: exact dimensions, a single solid where stated, files that reopen as native CADara documents and, where stated, variables that really drive the geometry.
- Aim to finish within about 60 tool calls. If you cannot finish, stop and report what blocked you.
- Finish with a short report: what you built, whether you believe it meets the task, and the main problems you hit. End with exactly one line, `TRIAL-RESULT: done` or `TRIAL-RESULT: gave-up`.
