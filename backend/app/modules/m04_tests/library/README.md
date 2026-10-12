# Built-in test library

One YAML file per OWASP Top 10 for LLM Applications (2025) category. Every entry must
match `TestDefinitionSpec` in `../schema.py`; the tests check this.

To add a test, add an entry here. When the API starts, new entries become version 1 and
changed entries get a new version automatically (FR-4.5).

**Content safety:** never write attack text here. Describe the objective, the success
condition and the detection methods. Attempts are generated at run time from the named safe
template with synthetic content and canary tokens.

**YAML tip:** if a sentence contains a colon followed by a space (`: `), put the whole value
in double quotes, or YAML reads it as a new key. The test `test_every_library_file_is_valid`
catches this.
