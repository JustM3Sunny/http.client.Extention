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

export function activate(context: vscode.ExtensionContext) {
    console.log('HTTP Client extension is now active!');

    // Register the command to open the HTTP Client view
    const disposable = vscode.commands.registerCommand('http-client.openView', () => {
        // Create and show a new webview
        const panel = vscode.window.createWebviewPanel(
            'httpClient',
            'HTTP Client',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
            }
        );

        // Set the HTML content for the webview
        getWebviewContent(context).then(html => {
            panel.webview.html = html;
        });

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
            async (message: { command: string; url?: string; method?: string; headers?: Record<string, string>; body?: any }) => {
                try {
                    if (message.command === 'sendRequest' && message.url && message.method) {
                        const response = await sendHttpRequest(
                            message.url,
                            message.method,
                            message.headers || {},
                            message.body
                        );
                        
                        panel.webview.postMessage({
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
                    panel.webview.postMessage({
                        command: 'error',
                        message: axiosError.message,
                        response: axiosError.response ? {
                            status: axiosError.response.status,
                            data: axiosError.response.data,
                            headers: axiosError.response.headers
                        } : undefined
                    });
                }                      return;
            },
            undefined,
            context.subscriptions
        );
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

async function getWebviewContent(context: vscode.ExtensionContext): Promise<string> {
    // Get the path to the webview HTML file
    const webviewPath = vscode.Uri.file(
        path.join(context.extensionPath, 'src', 'webview.html')
    );
    
    // Read the HTML file content
    try {
        const bytes = await vscode.workspace.fs.readFile(webviewPath);
        const decoder = new (require('util').TextDecoder)('utf-8');
        return decoder.decode(bytes);
    } catch (error) {
        console.error('Failed to load webview content:', error);
        return `
            <!DOCTYPE html>
            <html>
            <body>
                <h2>Error loading HTTP Client</h2>
                <p>Failed to load the HTTP Client interface. Please check the extension logs for details.</p>
                <p>Error: ${error instanceof Error ? error.message : String(error)}</p>
            </body>
            </html>
        `;
    }
}

export function deactivate() {}
