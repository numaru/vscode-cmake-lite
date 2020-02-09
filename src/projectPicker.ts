import * as vscode from "vscode";
import * as npath from "path";
import commonPathPrefix = require("common-path-prefix");

import { Extension } from "./extension";
import { createLogger } from "./logging";
import { CMakeProject } from "./cmake";

const log = createLogger("projectPicker");


export class ProjectPicker extends vscode.Disposable {
    private readonly _extension: Extension;
    private readonly _status: vscode.StatusBarItem;
    private readonly _quick: vscode.QuickPick<ProjectItem>;

    constructor(callOnDispose: Function, extension: Extension) {
        super(callOnDispose);
        this._extension = extension;
        this._status = vscode.window.createStatusBarItem();
        this._status.command = "vscode-cmake-lite.selectActiveProject";
        this._status.tooltip = "Select the CMake project to use with the C/C++ extension";
        this._status.text = "$(folder)";
        this._status.show();
        this._quick = vscode.window.createQuickPick<ProjectItem>();
        this._quick.placeholder = "Select a CMake project to use with the C/C++ extension";
    }

    async dispose(): Promise<void> {
        this._status.dispose();
        this._quick.dispose();
        super.dispose();
    }

    async askUserToSelectProject(): Promise<void> {
        const cancelSource = new vscode.CancellationTokenSource();
        this._quick.busy = true;
        this._quick.items = [];
        this._quick.show();
        const acceptSubscription = this._quick.onDidAccept(() => {
            const item = this._quick.selectedItems[0];
            this._quick.hide();
            vscode.commands.executeCommand("vscode-cmake-lite.activateProject", item?.uri);
        });
        const hideSubscription = this._quick.onDidHide(() => {
            cancelSource.cancel();
            acceptSubscription.dispose();
            hideSubscription.dispose();
        });
        log.info("Start looking for projects in workspace");
        const uris = await this.searchForProjects(cancelSource.token);
        log.info(`Project paths found in workspace: [${uris.map(p => p.fsPath)}]`);
        const items = [...uris.map(u => new ProjectItem(u)), new NoneItem()];
        this._quick.items = items;
        this._quick.busy = false;
        cancelSource.dispose();
    }

    activateProject(uri: vscode.Uri | undefined): void {
        if (uri) {
            this._status.text = `$(folder-active) ${ProjectItem.createLabel(uri)}`;
        } else {
            this._status.text = "$(folder)";
        }
        this._status.show();
    }

    async searchForProjects(token?: vscode.CancellationToken): Promise<vscode.Uri[]> {
        let uris = await vscode.workspace.findFiles("**/CMakeCache.txt", undefined, undefined, token);
        uris = uris.map(u => vscode.Uri.file(npath.dirname(u.fsPath)));
        await Promise.all(uris.map(u => CMakeProject.writeQuery(u)));
        return uris;
    }
}

export interface PickerItem extends vscode.QuickPickItem {
    alwaysShow?: boolean;
    label: string;
    detail?: string;
    uri?: vscode.Uri;
}

class ProjectItem implements PickerItem {
    label: string;
    detail?: string;
    uri?: vscode.Uri;

    constructor(uri: vscode.Uri) {
        this.uri = uri;
        this.label = `$(folder) ${ProjectItem.createLabel(uri)}`;
        this.detail = ProjectItem.createDetail(uri);
    }

    static createLabel(uri: vscode.Uri): string {
        return (vscode.workspace.workspaceFolders || [])
            .map(w => w.uri.fsPath)
            .map(w => npath.relative(w, uri.fsPath))
            .sort((a, b) => a.length - b.length)[0]
            .replace(/\\/g, "/");
    }

    static createDetail(uri: vscode.Uri): string | undefined {
        const paths = (vscode.workspace.workspaceFolders || []).map(w => w.uri.fsPath);
        let path;
        if (paths.length === 0) {
            return undefined;
        } else if (paths.length === 1) {
            path = npath.relative(paths[0], uri.fsPath);
        } else {
            path = npath.relative(commonPathPrefix(paths), uri.fsPath);
        }
        path = path.replace(/\\/g, "/");
        return `Select ${path}`;
    }
}

class NoneItem implements PickerItem {
    alwaysShow = true;
    label = "$(close) Deselect";
    detail = "Deselect all projects";
}
