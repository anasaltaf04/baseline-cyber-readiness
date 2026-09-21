# Deploy evidence

Terminal output from build and deploy sessions, kept so judges can see what
the agent actually ran rather than taking the write-up's word for it.

`scripts/deploy.sh` writes three files per run, timestamped in UTC:

| File | What it shows |
|---|---|
| `sts-identity-<stamp>.txt` | `aws sts get-caller-identity` — which AWS identity the agent was using |
| `pytest-<stamp>.txt` | The backend test run that gated the deploy |
| `cdk-deploy-<stamp>.txt` | The full `cdk deploy` output, including the resources changed and the stack outputs |

Twelve-digit account ids are replaced with `<ACCOUNT-ID>` by the script before
anything is written here. Check any file you add by hand for account ids, ARNs
containing them, and CloudFront distribution ids you would rather not publish.

## Nothing here yet

No deploy has run. The first build session had no valid AWS credentials — the
container's were placeholders and `get_caller_identity` returned
`InvalidClientTokenId` — so the stack was verified by reading its synthesised
CloudFormation instead.

Running `./scripts/deploy.sh` from a machine with real credentials populates
this directory.
