import { JSONSchema7 } from 'json-schema';

export type GroupSchemas = {
  group: SocketGroup;
  schemas: JSONSchema7[];
};

export class SocketGroup {
  _id: string;
  name: string;
  description: string;
  color: string;
  runtimes: string[];
  version: number;
}
