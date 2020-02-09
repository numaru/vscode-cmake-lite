import * as fs from "fs";
import * as npath from "path";
import * as vscode from "vscode";
import { debounce } from "debounce";
import { SourceFileConfigurationItem, WorkspaceBrowseConfiguration } from "vscode-cpptools";

import { Extension } from "./extension";
import { createLogger } from "./logging";

const log = createLogger("cmake");

const CLIENT_KEY = "client-vscode-cmake-lite";

type IntelliSenseMode = "msvc-x86" | "msvc-x64" | "gcc-x86" | "gcc-x64" | "clang-x86" | "clang-x64";
type Standard = "c89" | "c99" | "c11" | "c++98" | "c++03" | "c++11" | "c++14" | "c++17" | "c++20";
type Language = "C" | "CXX";

export class CMakeProject extends vscode.Disposable {
    private readonly _uri: vscode.Uri;
    private readonly _extension: Extension;
    private readonly _watcher: CMakeReplyWatcher;
    private _sourceFileConfigurationItems: SourceFileConfigurationItem[];
    private _workspaceBrowseConfiguration: WorkspaceBrowseConfiguration;

    constructor(callOnDispose: Function, extension: Extension, uri: vscode.Uri) {
        super(callOnDispose);
        this._uri = uri;
        this._extension = extension;
        this._watcher = new CMakeReplyWatcher(() => { }, () => this.updateConfigurations());
        this._sourceFileConfigurationItems = [];
        this._workspaceBrowseConfiguration = { browsePath: ["${workspaceFolder}"] };
        log.info(`Start watching the project: ${this._uri.fsPath}`);
        this.watchResult();
        this.updateConfigurations();
    }

    get uri(): vscode.Uri {
        return this._uri;
    }

    dispose() {
        log.info(`Stop watching the project: ${this._uri.fsPath}`);
        this._watcher.dispose();
        super.dispose();
    }

    async getSourceFileConfigurationItems(): Promise<SourceFileConfigurationItem[]> {
        return this._sourceFileConfigurationItems;
    }

    async getWorkspaceBrowseConfiguration(): Promise<WorkspaceBrowseConfiguration> {
        return this._workspaceBrowseConfiguration;
    }

    static async writeQuery(uri: vscode.Uri): Promise<void> {
        const path = CMakeProject.getQueryDirectory(uri).fsPath;
        const data = {
            "requests": [
                { "kind": "codemodel", "version": [{ "major": 2 }] },
                { "kind": "cache", "version": [{ "major": 2 }] },
                { "kind": "cmakeFiles", "version": [{ "major": 1 }] },
            ]
        };
        fs.mkdirSync(path, { recursive: true });
        fs.writeFileSync(npath.join(path, "query.json"), JSON.stringify(data, null, 2));
    }

    static getQueryDirectory(uri: vscode.Uri): vscode.Uri {
        return vscode.Uri.file(npath.join(
            uri.fsPath,
            ".cmake",
            "api",
            "v1",
            "query",
            CLIENT_KEY,
        ));
    }

    static getReplyDirectory(uri: vscode.Uri): vscode.Uri {
        return vscode.Uri.file(npath.join(
            uri.fsPath,
            ".cmake",
            "api",
            "v1",
            "reply",
        ));
    }

    private async watchResult(): Promise<void> {
        const path = CMakeProject.getReplyDirectory(this._uri).fsPath;
        fs.mkdirSync(path, { recursive: true });
        this._watcher.watch(path);
    }

    private async updateConfigurations(): Promise<void> {
        log.info("Update the configuration of the current project");
        const index = await this.readReply();
        if (index === undefined) return;
        const codemodel = index["reply"][CLIENT_KEY]["query.json"].responses
            .find((r: any) => r.kind === "codemodel");
        let configuration = codemodel.data.configurations
            .find((r: any) => r.name === this.getBuildType);
        if (configuration === undefined) {
            configuration = codemodel.data.configurations[0];
        }
        this._workspaceBrowseConfiguration = {
            browsePath: ["${workspaceFolder}"],
            compilerPath: this.getCompilerPath(index),
            compilerArgs: this.getTopCompilerArgs(index),
            standard: this.getTopStandard(index),
            windowsSdkVersion: this.getWindowsSdkVersion(index),
        };
        log.info(`Update the workspace configuration: ${JSON.stringify(this._workspaceBrowseConfiguration)}`);
        this._sourceFileConfigurationItems = configuration.targets
            .map((t: any) => {
                return t.data.sources
                    ?.filter((s: any) => s.compileGroupIndex !== undefined)
                    .map((s: any) => {
                        const group = t.data.compileGroups[s.compileGroupIndex];
                        return {
                            uri: vscode.Uri.file(npath.join(codemodel.data.paths.source, s.path)),
                            configuration: {
                                includePath: group.includes?.map((x: any) => x.path) || [],
                                defines: group.defines?.map((x: any) => x.define) || [],
                                intelliSenseMode: this.getIntelliSenseMode(index),
                                standard: this.getStandard(index, group),
                                forcedInclude: this.getForcedInclude(index, group),
                                compilerPath: this.getCompilerPath(index),
                                compilerArgs: this.getCompilerArgs(index, group),
                                windowsSdkVersion: this.getWindowsSdkVersion(index),
                            }
                        };
                    });
            })
            .filter((x: any) => !!x)
            .flat();
        log.info(`Update the source files configuration: ${JSON.stringify(this._sourceFileConfigurationItems)}`);
        this._extension.link.notify();
    }

    private async readReply(): Promise<any | undefined> {
        const getReplyDirectory = CMakeProject.getReplyDirectory(this._uri).fsPath;
        const lastIndexFile = await this.getLatestIndexFile();
        if (lastIndexFile === undefined) return;
        log.info(`Reading results from index ${lastIndexFile.fsPath}`);
        const index = JSON.parse(fs.readFileSync(lastIndexFile.fsPath).toString());
        const responses = index["reply"][CLIENT_KEY]["query.json"].responses;
        responses.forEach((r: any) => {
            const jsonFile = npath.join(getReplyDirectory, r.jsonFile);
            r.data = JSON.parse(fs.readFileSync(jsonFile).toString());
        });
        responses
            .find((r: any) => r.kind === "codemodel").data.configurations
            .forEach((c: any) => {
                c.targets.forEach((t: any) => {
                    const jsonFile = npath.join(getReplyDirectory, t.jsonFile);
                    t.data = JSON.parse(fs.readFileSync(jsonFile).toString());
                });
            });
        return index;
    }

    private async getLatestIndexFile(): Promise<vscode.Uri | undefined> {
        const directory = CMakeProject.getReplyDirectory(this._uri).fsPath;
        try {
            const files = fs.readdirSync(directory)
                .filter(f => f.match(/^index-.*?\.json$/g))
                .sort();
            const file = files.slice(-1)[0];
            if (files.length === 0) return;
            return vscode.Uri.file(npath.join(directory, file));
        } catch (e) {
            if (e.code !== "ENOENT") {
                throw e;
            }
        }
    }

    private getCompilerPath(index: any): string | undefined {
        const cache = index["reply"][CLIENT_KEY]["query.json"].responses
            .find((r: any) => r.kind === "cache");
        if (cache === undefined) return;
        const lang = this.getUsedLanguage(index);
        return cache.data.entries
            .find((e: any) => e.name === `CMAKE_${lang}_COMPILER`)?.value;
    }

    private getTopCompilerArgs(index: any): string[] | undefined {
        const cache = index["reply"][CLIENT_KEY]["query.json"].responses
            .find((r: any) => r.kind === "cache");
        if (cache === undefined) return;
        const lang = this.getUsedLanguage(index);
        const buildType = this.getBuildType(index);
        const args = cache.data.entries
            .filter((e: any) => [`CMAKE_${lang}_FLAGS`, `CMAKE_${lang}_FLAGS_${buildType.toUpperCase()}`].includes(e.name))
            .map((f: any) => f.value.split(" "))
            .flat()
            .filter((f: string) => f !== "");
        return args;
    }

    private getCompilerArgs(index: any, group: any): string[] | undefined {
        const args = group.compileCommandFragments
            ?.filter((x: any) => x.role === undefined || x.role === "flags")
            .map((x: any) => x.fragment.split(" "))
            .flat()
            .filter((x: string) => x !== "");
        return args;
    }

    private getIntelliSenseMode(index: any): IntelliSenseMode {
        if (process.platform === "win32") {
            return "msvc-x64";
        } else if (process.platform === "darwin") {
            return "clang-x64";
        } else {
            return "gcc-x64";
        }
    }

    private getTopStandard(index: any): Standard {
        const defaultStandard = this.getUsedLanguage(index) === "C" ? "c11" : "c++20";
        // TODO(knu) Find the standard based on the compiler flags
        return defaultStandard;
    }

    private getStandard(index: any, group: any): Standard {
        const defaultStandard = group.language === "C" ? "c11" : "c++20";
        // TODO(knu) Find the standard based on the compiler flags
        return defaultStandard;
    }

    private getUsedLanguage(index: any): Language {
        const codemodel = index["reply"][CLIENT_KEY]["query.json"].responses
            .find((r: any) => r.kind === "codemodel");
        if (codemodel === undefined) return "CXX";
        let configuration = codemodel.data.configurations
            .find((r: any) => r.name === this.getBuildType);
        if (configuration === undefined) {
            configuration = codemodel.data.configurations[0];
        }
        if (configuration === undefined) return "CXX";
        const langs = configuration.targets
            .map((t: any) => t.data.compileGroups?.map((g: any) => g.language))
            .flat()
            .filter((l: any) => !!l);
        if (langs.includes("CXX")) return "CXX";
        return "C";
    }

    private getForcedInclude(index: any, group: any): string[] | undefined {
        // TODO(knu) Find the forced includes based on compiler flags
        return undefined;
    }

    private getWindowsSdkVersion(index: any): string | undefined {
        // TODO(knu) Find the current windows sdk version
        return undefined;
    }

    private getBuildType(index: any): string {
        const cache = index["reply"][CLIENT_KEY]["query.json"].responses
            .find((r: any) => r.kind === "cache");
        if (cache === undefined) return "";
        const buildType = cache.data.entries
            .find((e: any) => e.name === "CMAKE_BUILD_TYPE")?.value;
        if (buildType === undefined) return "";
        return buildType;
    }
}

class CMakeReplyWatcher extends vscode.Disposable {
    private _watcher?: fs.FSWatcher;
    private readonly _update: any;

    constructor(callOnDispose: Function, onUpdate: () => void) {
        super(callOnDispose);
        this._update = debounce(onUpdate, 1000, true);
    }

    dispose(): void {
        this._update.clear();
        this._watcher?.close();
        super.dispose();
    }

    watch(path: string): void {
        if (!this._watcher) {
            this._watcher = fs.watch(path, {}, (event, filename) => {
                if (event === "rename" && filename.match(/^index-.*?\.json$/g)) {
                    this._update();
                }
            });
        }
    }
}
