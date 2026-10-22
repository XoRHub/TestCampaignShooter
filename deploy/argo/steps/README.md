# Hand-written Argo step templates

The Argo provider **generates** one step `WorkflowTemplate` per engine
(`tcs-step-<engine>`). To replace a generated template — or to **add a new
engine** without touching any code — drop a file here:

```
step-<engine>.yaml
```

Convention (the "step contract") — the template must be named `run-test` and
expose:

- `inputs.parameters`: `test-id`, `test-file`, `image`, `command`,
  `junit-path`, `timeout-seconds`
- `inputs.artifacts`: `source` (the test tree, mounted at `/workspace`)
- `outputs.artifacts`: `junit` pushed to
  `{{workflow.parameters.artifact-prefix}}/partials/{{inputs.parameters.test-id}}.xml`

At campaign launch time, the server first loads the files in this directory
(`ARGO_MANUAL_STEPS_DIR`): a file present here **takes precedence** over the
generated template for the same engine, and engines without a file stay
generated — no existing template is ever modified.

See `step-custom.yaml.sample` for a complete example.
