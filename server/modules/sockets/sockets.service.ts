import { Service } from 'typedi';
import * as local from '../shared/local-environment';
import { logger } from '@aitheon/core-server';
import { Project } from '@aitheon/creators-studio-server';
import { Action, param, Transporter, TransporterService } from '@aitheon/transporter';
import { join } from 'path';
import { FsUtils, Generator, LANGUAGE, LANGUAGE_ENUM } from '@aitheon/socket-type-generator';
import { GroupSchemas, SocketGroup } from './socket.model';

type Status = { status: number; message: string };

@Service()
@Transporter()
export class SocketsService extends TransporterService {
  constructor(broker: any, schema?: any) {
    super(broker, schema);
  }

  @Action()
  async generateSockets(
    @param({ type: 'any' }) groupSchemas: GroupSchemas,
    @param({ type: 'any' }) project: Project
  ): Promise<Status> {
    try {
      const generator = new Generator(this.createFsUtils(project));
      const groupName = this.groupToFolderName(groupSchemas.group);
      // @ts-ignore
      const languages: LANGUAGE[] = [ project.language ];
      if (project.runtime === Project.RuntimeEnum.AOS_CLOUD && project.language !== Project.LanguageEnum.TYPESCRIPT) {
        languages.push(LANGUAGE_ENUM.TYPESCRIPT);
      }
      logger.info('[SocketsService.generateSockets]', `Generating sockets group ${groupSchemas.group._id} for project ${project._id}`);

      await generator.generateGroup(groupName, groupSchemas.schemas, languages);
      logger.info('[generate-sockets.sh]', 'success');
      return { status: 0, message: '' };

    } catch (err) {
      logger.error('[SocketsService.generateSockets]', err);
      return { status: -1, message: err.message || err };
    }
  }

  @Action()
  async deleteSockets(
    @param({ type: 'any' }) project: Project,
    @param({ type: 'array' }) deletedGroups: SocketGroup[]
  ): Promise<Status> {
    try {
      for (const deleteGroup of deletedGroups) {
        const fsUtils = this.createFsUtils(project);
        logger.info('[SocketsService.deleteSockets]', `Deleting sockets group ${deleteGroup._id} for project ${project._id}`);
        fsUtils.deleteGroupFolders(this.groupToFolderName(deleteGroup));
      }
      return { status: 0, message: '' };
    } catch (err) {
      logger.error('[SocketsService.deleteSockets]', err);
      return { status: -1, message: err.message || err };
    }
  }

  private createFsUtils(project: Project): FsUtils {
    const paths = [local.BASE_LOCAL_PATH, project.slug];

    return new FsUtils(
      this.getPathForLang(paths), {
        [LANGUAGE_ENUM.TYPESCRIPT]: this.getPathForLang(paths, ['server']),
        [LANGUAGE_ENUM.CPP]: this.getPathForLang(paths, ['aitheon'])
      }
    );
  }

  private getPathForLang(base: string[], specific: string[] = []) {
    return join(...base, ...specific, 'sockets');
  }

  private groupToFolderName(group: SocketGroup) {
    return group.name;
  }
}

