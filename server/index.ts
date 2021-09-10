'use strict';

import 'ts-helpers';
// import 'source-map-support/register';
import 'reflect-metadata';
import * as path from 'path';
import { TransporterBroker } from '@aitheon/transporter';
import { environment } from './environment';
import { Container, Inject } from 'typedi';

const transportInit = () => {
    /**
     * Inner microservices communication via transporter
     */
    const metaPaths = [`${ path.resolve('./dist') }/modules/**/*.service.js`];
    const transporter = new TransporterBroker();
    transporter.init(metaPaths, environment.rabbitmq.uri, `SANDBOX_${ environment.sandbox._id }`, 'error');
    transporter.services.forEach((Service: any) => {
      const transporterSrv = new Service(transporter.broker);
      Container.set(Service, transporterSrv);
    });

    return transporter;
};
const transporter = transportInit();

import { Application } from './config/application';
export default new Application(transporter);