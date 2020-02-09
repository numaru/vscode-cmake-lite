import * as TransportStream from "winston-transport";
import * as vscode from "vscode";
import * as winston from "winston";


export class LoggingChannel extends vscode.Disposable {
    private readonly _channel: vscode.OutputChannel;

    private constructor(callOnDispose: Function, name: string) {
        super(callOnDispose);
        this._channel = vscode.window.createOutputChannel(name);
    }

    channel(): vscode.OutputChannel {
        return this._channel;
    }

    dispose(): void {
        this._channel?.dispose();
        LoggingChannel._instance = null;
        super.dispose();
    }

    private static _instance: LoggingChannel | null = null;

    static createInstance(name: string): LoggingChannel {
        LoggingChannel._instance?.dispose();
        LoggingChannel._instance = new LoggingChannel(() => { }, name);
        return LoggingChannel._instance;
    }

    static instance(): LoggingChannel | null {
        return LoggingChannel._instance;
    }
}

export function createLogger(label: string): winston.Logger {
    return winston.createLogger({
        format: winston.format.combine(
            winston.format.label({ label: label }),
            winston.format.timestamp(),
        ),
        transports: [new VSCodeTransport()]
    });
}

class VSCodeTransport extends TransportStream {
    constructor(opts?: TransportStream.TransportStreamOptions) {
        super(opts);
    }

    log(info: any, next: () => void) {
        const line = `[${info.timestamp}] [${info.label}] [${info.level}] ${info.message}`;
        LoggingChannel.instance()?.channel().appendLine(line);
        next();
    }
}
