# Sentra CLI

Command-line tool that CI/CD pipelines call to run a security gate and get a pass or fail result
(FR-9.4, module M9; UC-9.5 Run Security Gate).

It needs nothing but Python 3.12: the tool speaks HTTP through the standard library, so a pipeline
can run it in any Python image without installing dependencies.

## Use it

```bash
export SENTRA_URL=https://sentra.example.com
export SENTRA_API_KEY=...            # a key with the scopes "run security gate" and "read gate results"
python -m sentra_cli gate run --gate G-001 --wait --timeout 30m \
  --build-ref "$GITHUB_REF_NAME" --build-commit "$GITHUB_SHA" --build-url "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
```

Installed as a package (`pip install .`), the same command is `sentra gate run …`.

`--build-ref`, `--build-commit` and `--build-url` can also come from `SENTRA_BUILD_REF`,
`SENTRA_BUILD_COMMIT` and `SENTRA_BUILD_URL`. They are what links the gate run to the release in
Sentra, so every build has its security history.

## What the exit codes mean

| Code | What happened |
|---|---|
| 0 | The run completed and no new finding broke the gate policy. |
| 1 | The run completed and the policy failed it: the findings are printed, and the release should stop. |
| 2 | Sentra could not check this release — a refused or expired key, a gate that could not start, a run that did not complete, or no result within the time limit. |

A gate never passes on anything but a completed run (UC-9.5, quality requirement 2), so a pipeline
can treat any non-zero code as "do not release".

## Example: GitHub Actions

```yaml
- name: Sentra security gate
  env:
    SENTRA_URL: ${{ vars.SENTRA_URL }}
    SENTRA_API_KEY: ${{ secrets.SENTRA_API_KEY }}
  run: |
    python -m sentra_cli gate run --gate G-001 --wait --timeout 30m \
      --build-ref "$GITHUB_REF_NAME" --build-commit "$GITHUB_SHA"
  working-directory: cli
```

## Develop

```bash
pip install -r requirements-dev.txt
ruff check . && ruff format --check .
pytest -q
```
