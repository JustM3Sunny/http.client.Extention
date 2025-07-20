import * as vscode from 'vscode';
import * as path from 'path';
import axios from 'axios';

// Using custom interfaces to resolve type issues
interface AxiosRequestConfig extends Record<string, any> {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    data?: any;
}

interface AxiosResponse<T = any> {
    data: T;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    config: AxiosRequestConfig;
}

interface AxiosError extends Error {
    config: AxiosRequestConfig;
    code?: string;
    request?: any;
    response?: AxiosResponse;
    isAxiosError: boolean;
    toJSON: () => object;
}

class HttpViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'http-client.view';
    private _view?: vscode.WebviewView;
    private _disposables: vscode.Disposable[] = [];

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        this._updateWebview(webviewView);

        // Handle messages from the webview
        const messageDisposable = webviewView.webview.onDidReceiveMessage(
            async (message: { command: string; url?: string; method?: string; headers?: Record<string, string>; body?: any }) => {
                try {
                    if (message.command === 'sendRequest' && message.url && message.method) {
                        const response = await sendHttpRequest(
                            message.url,
                            message.method,
                            message.headers || {},
                            message.body
                        );
                        
                        webviewView.webview.postMessage({
                            command: 'response',
                            data: response.data,
                            status: response.status,
                            headers: response.headers,
                            statusText: response.statusText || ''
                        });
                    }
                } catch (error) {
                    console.error('Request failed:', error);
                    const axiosError = error as AxiosError;
                    webviewView.webview.postMessage({
                        command: 'error',
                        message: axiosError.message,
                        response: axiosError.response ? {
                            status: axiosError.response.status,
                            data: axiosError.response.data,
                            headers: axiosError.response.headers
                        } : undefined
                    });
                }
            }
        );

        // Store the disposable
        this._disposables.push(messageDisposable);
        
        // Clean up on dispose
        webviewView.onDidDispose(() => {
            this._disposables.forEach(d => d.dispose());
            this._disposables = [];
        });
    }
    
    private async _updateWebview(webviewView: vscode.WebviewView) {
        if (!this._view) {
            return;
        }

        const webview = webviewView.webview;
        const stylesUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'styles.css')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js')
        );

        // Get the HTML content
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'src', 'webview.html');
        let html = await vscode.workspace.fs.readFile(htmlPath);
        
        // Replace placeholders with actual URIs
        let htmlContent = html.toString()
            .replace(/\${stylesUri}/g, stylesUri.toString())
            .replace(/\${scriptUri}/g, scriptUri.toString());

        this._view.webview.html = htmlContent;
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('HTTP Client extension is now active!');

    // Register the webview view provider
    const provider = new HttpViewProvider(context.extensionUri);
    
    // Register the view provider
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(HttpViewProvider.viewType, provider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // Register the command to open the HTTP Client view
    const disposable = vscode.commands.registerCommand('http-client.openView', () => {
        // Show the view in the sidebar
        vscode.commands.executeCommand('workbench.view.extension.http-client');
        // Focus the view
        vscode.commands.executeCommand('http-client.view.focus');
    });

    context.subscriptions.push(disposable);
}

async function sendHttpRequest(
    url: string, 
    method: string, 
    headers: Record<string, string> = {}, 
    body?: any
): Promise<AxiosResponse> {
    const config: AxiosRequestConfig = {
        method: method.toLowerCase(),
        url: url,
        headers: {
            'Content-Type': 'application/json',
            ...headers
        },
        validateStatus: () => true // To ensure we get the response even for error status codes
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        try {
            // If body is a string that's valid JSON, parse it
            if (typeof body === 'string') {
                config.data = JSON.parse(body);
            } else {
                config.data = body;
            }
        } catch (e) {
            // If not valid JSON, send as is
            config.data = body;
        }
    }

    console.log('Sending request with config:', config);
    return await axios.request(config);
}

async function getWebviewContent(extensionUri: vscode.Uri): Promise<string> {
    try {
        // Get the path to the webview HTML file
        const webviewPath = vscode.Uri.joinPath(extensionUri, 'src', 'webview.html');
        const fileContent = await vscode.workspace.fs.readFile(webviewPath);
        return fileContent.toString();
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>HTTP Client Error</title>
                <style>
                    body { 
                        font-family: Arial, sans-serif; 
                        padding: 20px; 
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                    }
                    h2 { color: #e06c75; }
                    .error { color: #e06c75; font-family: monospace; }
                </style>
            </head>
            <body>
                <h2>Error loading HTTP Client</h2>
                <p>Failed to load the HTTP Client interface. Please check the extension logs for details.</p>
                <p class="error">${errorMessage}</p>
            </body>
            </html>
        `;
    }
}

export function deactivate() {}
