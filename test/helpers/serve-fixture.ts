/*
 * Starts the pretend app with planted bugs (test/fixtures/buggy-app) so ShipCheck can be tried
 * by hand: `npm run fixture`, then in a second terminal the command this prints.
 * Local only (127.0.0.1); stop it with Ctrl+C.
 */
import { startFixtureServer } from './fixture-server.js';

const port = Number(process.env.PORT ?? 4173);
const app = await startFixtureServer({ port });
process.stdout.write(
  [
    `The pretend app is running at ${app.url}  (stop with Ctrl+C)`,
    '',
    'Try ShipCheck on it from a second terminal, in the same folder:',
    `  npm run build && node dist/cli.js ${app.url} --no-ai`,
    '',
    '',
  ].join('\n'),
);
process.on('SIGINT', () => void app.close().then(() => process.exit(0)));
