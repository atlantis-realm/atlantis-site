# Atlantis website

This site is under development. Thanks for having a look, or being a part of it.

## Developing

1. `pnpm install`

2. start a development server:

```sh
pnpm dev

# or start the server and open the app in a new browser tab
pnpm dev -- --open
```

## Building

To create a production version of your app:

```sh
pnpm build
```

You can preview the production build with `pnpm preview`.

This site uses the static adapter. You don't need to build it locally unless you're troubleshooting; once pushed to the GitHub repo it'll get built and deployed on Coolify.
