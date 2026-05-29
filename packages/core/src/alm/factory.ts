import type { Config } from '../schemas/config.js';
import type { AlmAdapter } from './interface.js';
import { NoneAlm } from './none.js';
import { GitHubAlm } from './github.js';
import { GitLabAlm } from './gitlab.js';
import { AzureDevOpsAlm } from './azure-devops.js';
import { BitbucketAlm } from './bitbucket.js';

export function createAlmAdapter(config: Config): AlmAdapter {
  switch (config.alm.platform) {
    case 'github':
      return new GitHubAlm();
    case 'gitlab':
      return new GitLabAlm();
    case 'azure-devops':
      return new AzureDevOpsAlm();
    case 'bitbucket':
      return new BitbucketAlm();
    default:
      return new NoneAlm();
  }
}
