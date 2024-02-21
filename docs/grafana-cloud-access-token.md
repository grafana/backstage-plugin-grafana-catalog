# Grafana Cloud Access Token

For the config section for this plugin, you need to provide:

- Your stack "slug"
- A Cloud Access Policy Token

The `stack_slug` is the name of your Grafana cloud stack. If you only have one stack, your org name will be the same as the stack slug.

In order to create a token, navigate to `https://grafana.com/orgs/<your org name>` select "Access Policies" on the left:

![access policies](./01-cloud-access-policy.png)

Next select "Create access policy":

![create access policy](./02-create-cloud-access-policy.png)

Give your policy a memorable name.

Under "Realms" you MUST choose the stack you want this token for. _Note: You must select a single stack, not the whole org_, or this will not work.

Then add the "Scopes" for this policy. Select "Add Scope" to choose the following scopes:

![ap1](./03-create-new-access-policy.png)

You must include at least the following scopes:

- stacks:read
- service-model:read
- service-model:write
- service-model:delete

![cloud access policy stack read](./04-cloud-access-policy-stacks-read.png)

Your Policy should look like this in the end.

![](./05-cloud-access-policy-final.png)

Click "Create"

Now you need to create a Token from this policy. Click on "Add Token", give it a name, an expiration time, and Create it.

![](./06-add-token.png)

Put this token in your `app-config.yaml` in the `token:` config item above.
