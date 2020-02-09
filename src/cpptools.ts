import * as cpptools from "vscode-cpptools";
import * as vscode from "vscode";
import {
    CppToolsApi,
    CustomConfigurationProvider,
    SourceFileConfigurationItem,
    Version,
    WorkspaceBrowseConfiguration
} from "vscode-cpptools";
import { CancellationToken } from "vscode-jsonrpc";

import { Extension } from "./extension";
import { createLogger } from "./logging";

const log = createLogger("cpptools");


export class CppToolsLink extends vscode.Disposable {
    private readonly _extension: Extension;
    private readonly _provider: CMakeConfigurationProvider;
    private readonly _api: Promise<CppToolsApi>;

    constructor(callOnDispose: Function, extension: Extension) {
        super(callOnDispose);
        this._extension = extension;
        this._provider = new CMakeConfigurationProvider(this._extension);
        this._api = getCppToolsApi(Version.latest);
        this._api
            .then(api => {
                api.registerCustomConfigurationProvider(this._provider);
                api.notifyReady(this._provider);
            })
            .catch(error => log.error(error));
    }

    async dispose(): Promise<void> {
        (await this._api).dispose();
        this._provider.dispose();
        super.dispose();
    }

    notify(): void {
        this._api
            .then(api => {
                api.didChangeCustomConfiguration(this._provider);
                api.didChangeCustomBrowseConfiguration(this._provider);
            })
            .catch(error => log.error(error));
    }
}

function getCppToolsApi(version: Version): Promise<CppToolsApi> {
    return new Promise<CppToolsApi>((resolve, reject) => {
        cpptools.getCppToolsApi(version).then(api => {
            if (api) {
                resolve(api);
            } else {
                reject(`CppToolsApi not found for version ${version}`);
            }
        });
    });
}

class CMakeConfigurationProvider implements CustomConfigurationProvider {
    readonly name: string = "CMake Lite";
    readonly extensionId: string = "numaru.vscode-cmake-lite";

    private readonly _extension: Extension;

    constructor(extension: Extension) {
        this._extension = extension;
    }

    async dispose(): Promise<void> {

    }

    canProvideConfiguration(uri: vscode.Uri, token?: CancellationToken): Thenable<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            resolve(true);
        });
    }

    provideConfigurations(uris: vscode.Uri[], token?: CancellationToken): Thenable<SourceFileConfigurationItem[]> {
        return new Promise<SourceFileConfigurationItem[]>((resolve, reject) => {
            const project = this._extension.project;
            if (project) {
                log.info(`Provide configurations for ${uris}`);
                project.getSourceFileConfigurationItems()
                    .then(config => resolve(config))
                    .catch(e => reject(e));
            } else {
                log.info(`Provide default configurations for ${uris}`);
                resolve([]);
            }
        });
    }

    canProvideBrowseConfiguration(token?: CancellationToken): Thenable<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            resolve(true);
        });
    }

    provideBrowseConfiguration(token?: CancellationToken): Thenable<WorkspaceBrowseConfiguration> {
        return new Promise<WorkspaceBrowseConfiguration>((resolve, reject) => {
            const project = this._extension.project;
            if (project) {
                log.info("Provide browse configuration");
                project.getWorkspaceBrowseConfiguration()
                    .then(config => resolve(config))
                    .catch(e => reject(e));
            } else {
                log.info("Provide default browse configuration");
                resolve({ browsePath: ["${workspaceFolder}"] });
            }
        });
    }

    canProvideBrowseConfigurationsPerFolder(token?: CancellationToken): Thenable<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            resolve(false);
        });
    }

    provideFolderBrowseConfiguration(uri: vscode.Uri, token?: CancellationToken): Thenable<WorkspaceBrowseConfiguration> {
        return new Promise<WorkspaceBrowseConfiguration>((resolve, reject) => {
            log.error("Not implemented method: provideFolderBrowseConfiguration()");
            reject("Not implemented error");
        });
    }
}