import { Service, Inject, Container } from 'typedi';
import * as git from 'nodegit';
import * as fs from 'fs-extra';
import { resolve as resolvePath } from 'path';
import { environment } from '../../environment';
import { logger, User } from '@aitheon/core-server';
import { Transporter, TransporterService, Action, Event, param } from '@aitheon/transporter';
import { Context } from 'moleculer';
import { promisify } from 'util';
import * as chokidar from 'chokidar';
import { GitService } from '../git/git.service';
import * as local from '../shared/local-environment';
import { Project } from '@aitheon/creators-studio-server';
import * as shelljs from 'shelljs';
import * as ini from 'ini';
import { uniqBy } from 'lodash';

@Service()
@Transporter()
export class SandboxService extends TransporterService {

  gitService: GitService;

  constructor(broker: any, schema?: any) {
    super(broker, schema);
    this.gitService = Container.get(GitService);
    this.initWorkspaceWatcher();
    this.verifySshMode();
    this.ensureGitConfig();
    this.initSandboxConfig();
    this.sanitizeSavedProjects();
  }

  async initSandboxConfig() {
    if (process.env['sandbox.json']) {
      await fs.writeFile(`${local.HOME_DIR}/.local/share/sandbox.json`, process.env['sandbox.json']);
    }
  }

  /**
   * Sanitize old sandboxes to prevent bad project configs
   */
  async sanitizeSavedProjects() {
    try {
      const projectPath = `${local.HOME_DIR}/.local/share/projects.json`;
      let currentProjects = await fs.pathExists(projectPath) ? await fs.readJSON(projectPath) : [];
      currentProjects = uniqBy(currentProjects.filter((p: any) => !!p._id), '_id');
      await fs.writeJSON(projectPath, currentProjects);

    } catch (err) {
      logger.info('[sanitizeSavedProjects]', err);
    }
  }

  initWorkspaceWatcher() {
    // ~/.local/share/code-server
    chokidar.watch(local.WORKSPACE_FILE_PATH).on('change', async (event, path) => {
      try {
        // logger.info('[initWorkspaceWatcher]', event);
        const workspace = JSON.parse((await fs.readFile(local.WORKSPACE_FILE_PATH)).toString());
        const folders = workspace.folders.map((f: any) => f.path);
        const directories = fs.readdirSync(local.BASE_LOCAL_PATH, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => dirent.name);

        const foldersToDelete = directories.filter((name) => folders.indexOf(name) === -1);
        const projectPath = `${local.HOME_DIR}/.local/share/projects.json`;
        const currentProjects = await fs.pathExists(projectPath) ? await fs.readJSON(projectPath) : [];

        foldersToDelete.forEach(async (dirName) => {
          try {
            await fs.remove(`${local.BASE_LOCAL_PATH}/${dirName}`);
            const projectIndex = currentProjects.findIndex((p: any) => p.slug === dirName);
            if (projectIndex > -1) {
              currentProjects.splice(projectIndex, 1);
              await fs.writeJSON(projectPath, currentProjects);
              logger.info(`[initWorkspaceWatcher] removed project by path: ${ dirName }`);
            }
          } catch (err) {
            logger.info('[unlink]: ', err);
          }
        });
      } catch (err) {
        logger.info('[initWorkspaceWatcher]: ', err);
      }
    });
  }

  async verifySshMode() {
    try {
      const privatePath = await fs.pathExists(local.PRIVATE_KEY_PATH);
      console.log('privatePath exist', privatePath);
      if (privatePath) {
        await fs.chmod(local.PRIVATE_KEY_PATH, 0o400);
        await fs.chmod(local.PUBLIC_KEY_PATH, 0o400);
      }
      logger.info('[verifySshMode] done');
    } catch (err) {
      logger.error('[verifySshMode]', err);
    }
  }

  async setRunningStatus() {
    try {
      this.broker.emit('SandboxesService.updateStatus', { sandboxId: environment.sandbox._id, status: 'RUNNING' }, ['CREATORS_STUDIO', 'BUILD_SERVER']);
      logger.info('[setRunningStatus]: RUNNING;', environment.sandbox._id);
    } catch (err) {
      logger.error('[setRunningStatus]', err);
    }
  }

  @Action()
  async setupUser(
    @param({ type: 'any' }) user: User,
    @param({ type: 'any' }) ssh: { publicKey: string, privateKey: string },
    @param({ type: 'string', optional: true }) organization?: string,
    @param({ type: 'any', optional: true }) initRepositories?: Array<{ username: string, repositoryName: string }>,
    @param({ type: 'any', optional: true }) token?: string,
    @param({ type: 'any', optional: true }) domain?: string
  ) {
    try {
      logger.info('[SandboxService.setupUser]', `Setup user ${user._id}; ${organization ? `organization: ${organization}` : ''}`);
      await fs.ensureDir(`${local.HOME_DIR}/.ssh`);
      await fs.writeFile(local.PRIVATE_KEY_PATH, ssh.privateKey, { mode: 400 });
      await fs.writeFile(local.PUBLIC_KEY_PATH, ssh.publicKey, { mode: 400 });

      const sandboxConfig = {
        sandbox: environment.sandbox._id,
        domain,
        token,
        organization,
        user: { _id: user._id, email: user.email },
      };
      await fs.writeJSON(`${local.HOME_DIR}/.local/share/sandbox.json`, sandboxConfig);

      const gitConfig = `[user]\n\tname = ${user.profile.firstName} ${user.profile.lastName}\n\temail = ${user.email}\n`;
      await fs.writeFile(`${local.HOME_DIR}/.gitconfig`, gitConfig);
      // await fs.ensureDir(`${ local.HOME_DIR }/.local/share`);
      await fs.writeFile(`${local.HOME_DIR}/.local/share/.gitconfig`, gitConfig);
      logger.info('[SandboxService.setupUser]', `Setup user Done`);
    } catch (err) {
      logger.error('[setupUser]', err);
      throw err;
    }
  }

  @Action()
  async loadProject(@param({ type: 'string' }) ownerUsername: string, @param({ type: 'any' }) project: Project) {
    try {
      const repositoryName = project.slug;
      const projectPath = `${local.HOME_DIR}/.local/share/projects.json`;
      const currentProjects = await fs.pathExists(projectPath) ? await fs.readJSON(projectPath) : [];

      // property not used, it's overhead
      delete (project as any)['generatedSocketGroups'];
      const projectIndex = currentProjects.findIndex((p: any) => p._id === project._id);
      if (projectIndex === -1) {
        currentProjects.push(project);
        logger.info(`[SandboxService.loadProject] Added project to list [${project._id}] ${ project.slug}`);
        await fs.writeJSON(projectPath, currentProjects);
      }
      const localPath = `${ local.BASE_LOCAL_PATH }/${ repositoryName }`;
      if (await fs.pathExists(localPath)) {
        logger.info('[SandboxService.loadProject] Path already exist. Just adding to workspace.', repositoryName);
      } else {
        await this.gitService.clone(ownerUsername, repositoryName);
        logger.info('[SandboxService.loadProject] Cloned', repositoryName);
      }
      await this.addProjectToWorkspace(repositoryName);

      // TODO: move init logic to gitea templates when it's possible
      if (project.projectType === Project.ProjectTypeEnum.APP) {
        await fs.writeJSON(`${local.BASE_LOCAL_PATH}/${repositoryName}/${project.slug.toLowerCase()}.graph-app.json`, { _id: project._id, slug: project.slug, name: project.name });
      }

      logger.info('[SandboxService.loadProject] Loaded', project.slug, project.projectType, project.language);
    } catch (err) {
      logger.error(`[SandboxService.loadProject]`, err);
      throw err;
    }
  }

  @Action()
  async activeProjects() {
    try {
      const workspace = JSON.parse((await fs.readFile(local.WORKSPACE_FILE_PATH)).toString());
      return  {success: true, payload: workspace.folders.map((folder: { path: string }) => folder.path)};
    } catch (err) {
      logger.error('[SandboxService.activeProjects]', err);
      return {error: true};
    }
  }

  @Event()
  async shutdown(payload: { force: true }) {
    console.log('[SandboxService] Shutting down');
    let status;
    try {
      const workspace = JSON.parse((await fs.readFile(local.WORKSPACE_FILE_PATH)).toString());
      await this.ensureGitConfig();
      const gitConfig = ini.decode((await fs.readFile(`${local.HOME_DIR}/.gitconfig`)).toString());
      const all = workspace.folders.map((folder: { path: string }) => {
        return new Promise(async (resolve, reject) => {
          try {
            const path = resolvePath(`${local.BASE_LOCAL_PATH}/${folder.path}`);
            console.log('Saving:', path);
            const branch = new Date().toISOString().replace(/[T|:]/g, '-').slice(0, -5);
            await this.gitService.push(path, `backup-${branch}`, 'Backup changes', gitConfig.user.name, gitConfig.user.email);
            resolve();
          } catch (err) {
            if (!payload || payload && payload.force) {
              logger.error(`[shutdown] Error on save repo`, err);
              return resolve();
            }
            logger.error('Saving err:', err);
            reject(err);
          }
        });
      });
      if (all.length > 0) {
        await Promise.all(all);
      }
      logger.log('[SandboxService] Sending SHUTTING_DOWN_READY');
      status = 'SHUTTING_DOWN_READY';
    } catch (err) {
      logger.error('[SandboxService.shutdown] SHUTTING_DOWN_ERROR', err);
      status = 'SHUTTING_DOWN_ERROR';
    }
    this.broker.emit('SandboxesService.updateStatus', { sandboxId: environment.sandbox._id, status }, ['CREATORS_STUDIO', 'BUILD_SERVER']);
  }


  @Action()
  async commit(@param({ type: 'string' }) branch: string, @param({type: 'string'}) commitMessage: string, @param({type: 'string'}) projectSlug: string) {
    try {
      const workspace = JSON.parse((await fs.readFile(local.WORKSPACE_FILE_PATH)).toString());
      await this.ensureGitConfig();
      const gitConfig = ini.decode((await fs.readFile(`${local.HOME_DIR}/.gitconfig`)).toString());
      let folders = workspace.folders;
      if (projectSlug) {
        folders = workspace.folders.filter((folder: { path: string }) => folder.path === projectSlug);
      }
      const all = folders.map((folder: { path: string }) => {
        return new Promise(async (resolve, reject) => {
          try {
            const path = resolvePath(`${local.BASE_LOCAL_PATH}/${folder.path}`);
            console.log('Saving:', path);
            await this.gitService.push(path, branch, commitMessage, gitConfig.user.name, gitConfig.user.email);
            await this.gitService.hardReset(path, branch);
            resolve();
          } catch (err) {
            logger.error('Saving err:', err);
            reject(err);
          }
        });
      });
      if (all.length > 0) {
        await Promise.all(all);
      }

    } catch (err) {
      logger.error('[SandboxService.commit]', err);
      return {error: true, message: 'Commit failed'};
    }
    return {success: true, message: 'Commit Successful'};
  }

  async ensureGitConfig() {
    if (await fs.pathExists(`${local.HOME_DIR}/.local/share/.gitconfig`)) {
      await fs.copy(`${local.HOME_DIR}/.local/share/.gitconfig`, `${local.HOME_DIR}/.gitconfig`);
    }
  }

  async addProjectToWorkspace(path: string) {
    let workspace = { folders: [] as any, settings: {} };
    if (await fs.pathExists(local.WORKSPACE_FILE_PATH)) {
      workspace = JSON.parse((await fs.readFile(local.WORKSPACE_FILE_PATH)).toString());
    }
    const folderIndex = workspace.folders.findIndex((f: any) => f.path === path);
    if (folderIndex === -1) {
      workspace.folders.push({ path });
    }
    const newWorkspace = JSON.stringify(workspace, undefined, 2);
    await fs.writeFile(local.WORKSPACE_FILE_PATH, newWorkspace);
    logger.info(`[addProjectToWorkspace] Added project to workspace: ${ path }`);

  }

}

