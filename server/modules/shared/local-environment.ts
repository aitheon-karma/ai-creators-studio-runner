import { environment } from '../../environment';

export const HOME_DIR = environment.sandbox.homeDir || `/home/${environment.sandbox.localUser}`;
export const PRIVATE_KEY_PATH = `${ HOME_DIR }/.ssh/id_rsa`;
export const PUBLIC_KEY_PATH = `${ HOME_DIR }/.ssh/id_rsa.pub`;
export const BASE_LOCAL_PATH = `${ HOME_DIR }/workspace`;
export const WORKSPACE_FILE_PATH = `${ BASE_LOCAL_PATH }/workspace.code-workspace`;
export const ISAAC_SDK_APPS = '/opt/isaac-sdk/apps';