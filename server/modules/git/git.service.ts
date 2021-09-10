import { Service, Inject } from 'typedi';
import * as git from 'nodegit';
import * as fs from 'fs-extra';
import { environment } from '../../environment';
import * as local from '../shared/local-environment';
import { logger } from '@aitheon/core-server';
import { Transporter, TransporterService, Action, Event, param } from '@aitheon/transporter';
import { Context } from 'moleculer';
import { promisify } from 'util';
import * as chokidar from 'chokidar';


@Service()
@Transporter()
export class GitService extends TransporterService {

  publicKey: string;
  privateKey: string;

  constructor(broker: any, schema?: any) {
    super(broker, schema);
  }


  fetchKeys() {
    if (!this.privateKey) {
      this.privateKey = fs.readFileSync(local.PRIVATE_KEY_PATH).toString();
    }
    if (!this.publicKey) {
      this.publicKey = fs.readFileSync(local.PUBLIC_KEY_PATH).toString();
    }
  }

  getCredentials() {
    this.fetchKeys();
    return git.Cred.sshKeyMemoryNew('git', this.publicKey, this.privateKey, '');
  }

  getRepoUrl(ownerUsername: string, repoName: string): string {
    return `ssh://git@${ environment.git.sshHost }/${ ownerUsername }/${ repoName }.git`;
  }

  private async commit(repository: git.Repository, message: string, username?: string, email?: string) {
    const repoIndex = await repository.refreshIndex();
    await repoIndex.addAll();

    const oid = await repoIndex.writeTree();
    const isEmpty = await repository.isEmpty();
    let parent;
    if (isEmpty === 0) {
      parent = await git.Reference.nameToId(repository, 'HEAD');
    }

    const author = git.Signature.now(username, email);
    const committer = git.Signature.now(username, email);

    const commitResult = await repository.createCommit('HEAD', author, committer, message, oid, parent ? [parent] : []);
    logger.info(`[GitService] commitResult:`, commitResult);
    return commitResult;
  }

  private async createBranch(repository: git.Repository, branch: string, useCommit: git.Oid) {
    try {
      const commit = useCommit || await repository.getHeadCommit();
      await repository.createBranch(branch, commit, false);
    } catch (error) {
      return false;
    }
  }

  async push(repoPath: string, branch: string, message: string, username: string, email: string) {
    try {
      if (!await fs.pathExists(repoPath)) {
        // throw new Error('[GitService]: folder does not exits!');
        return;
      }
      if (!await fs.pathExists(`${ repoPath }/.git`)) {
        logger.info(`[GitService] Path is not a git repo. Skiped. ${ repoPath }`);
        return;
      }

      const repository = await git.Repository.open(repoPath);
      const status = await repository.getStatus();
      if (status.length === 0) {
        logger.info(`[GitService] No changes in git repo skipping ${ repoPath }`);
        return;
      }
      const commit = await this.commit(repository, message, username, email);
      this.createBranch(repository, branch, commit);
      logger.info(`[GitService] commit done: ${ repoPath }`);

      const remote = await repository.getRemote('origin');

      await remote.push([`refs/heads/${ branch }:refs/heads/${ branch }`], {
        callbacks: {
          certificateCheck: () => { return 1; },
          credentials: (url: string, userName: string) => {
            return this.getCredentials();
          }
        }
      });
      await repository.cleanup();
      logger.info(`[GitService] push done: ${ repoPath }`);
    } catch (err) {
      logger.error('[GitService] push:', err);
      throw err;
    }
  }

  async hardReset(repoPath: string, branch: string, ) {
    const repository = await git.Repository.open(repoPath);
    const latestCommit = await repository.getBranchCommit(branch);
    const result =  await git.Reset.reset(repository, latestCommit, git.Reset.TYPE.HARD, {});
    console.log('gir reset', repoPath, latestCommit.id());
    return result;
  }

  async clone(ownerUsername: string, repositoryName: string) {
    try {
      const localPath = `${ local.BASE_LOCAL_PATH }/${ repositoryName }`;
      const remote = this.getRepoUrl(ownerUsername, repositoryName);
      logger.info('[GitService] Clonning Remote: ', remote);
      const repo = await git.Clone.clone(remote, localPath, {
        fetchOpts: {
          callbacks: {
            certificateCheck: () => { return 1; },
            credentials: (url: string, userName: string) => {
              logger.info('[GitService] Getting creds');
              return this.getCredentials();
            }
          }
        }
      });

      logger.info('[GitService] Clonning done;', remote);
      return true;
    } catch (err) {
      logger.error('[GitService] clone:', err);
      throw err;
    }
  }
}

