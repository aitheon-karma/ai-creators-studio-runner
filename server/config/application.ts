import * as http from 'http';
import * as path from 'path';
import { environment } from '../environment';
import { ExpressConfig, logger } from '@aitheon/core-server';
import * as docs from '@aitheon/core-server';
import { TransporterBroker } from '@aitheon/transporter';
import { Container } from 'typedi';
import { GitService } from '../modules/git/git.service';
import { SandboxService } from '../modules/sandbox/sandbox.service';

export class Application {

  server: http.Server;
  express: ExpressConfig;
  transporter: TransporterBroker;

  constructor(transporter: TransporterBroker) {
    this.start(transporter);
  }

  async start(transporter: TransporterBroker) {
    try {
      this.express = new ExpressConfig();
      /**
       * Inner microservices communication via transporter
       */
      this.transporter = transporter;
      await this.transporter.start();

      const sandboxService = Container.get(SandboxService);
      sandboxService.setRunningStatus();
      /**
       * Start server
       */
      logger.debug(`
        ------------
        Sandbox ${ environment.sandbox._id } Started!
        ------------
      `);

    } catch (err) {
      logger.error('[Application] Start error', err);
      process.exit();
    }
  }

}