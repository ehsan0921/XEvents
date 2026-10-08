import { parseConfig, validateBranch, validateSeparation, buildConfig } from './deployment-config.mjs';
import { temporaryConfig, wrangler, requireCredentials } from './deployment-tools.mjs';

try {
  const environment = process.env.DEPLOY_ENVIRONMENT;
  validateBranch(environment, process.env.GITHUB_REF_NAME || process.env.GH_REF_NAME);
  requireCredentials();
  const config = parseConfig(process.env.WRANGLER_CONFIG_JSON);
  if (environment === 'development') validateSeparation(config, parseConfig(process.env.PRODUCTION_CONFIG_JSON));
  const generated = await temporaryConfig(await buildConfig(config, environment), 'ci');
  try {
    // This only changes the selected environment; there is no dev-to-production data copy.
    await wrangler(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', generated.path]);
    await wrangler(['deploy', '--config', generated.path, '--keep-vars']);
    const health = await fetch(new URL('/', config.vars.APP_URL), { signal: AbortSignal.timeout(15000) });
    if (!health.ok || (await health.json()).status !== 'running') throw new Error('Deployment completed, but the service health check failed.');
    console.log('D1 migrations applied and ' + environment + ' deployed.');
  } finally { await generated.cleanup(); }
} catch (error) {
  console.error(error instanceof TypeError ? 'Deployment failed. Verify the private environment configuration and network connection.' : error.message);
  process.exitCode = 1;
}
