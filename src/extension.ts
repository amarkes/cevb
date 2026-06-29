import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import { suggestCommitMessage, findClaudeBinary } from './commitSuggester';

export function activate(context: vscode.ExtensionContext) {
  const command = vscode.commands.registerCommand(
    'commitElaborator.suggestMessage',
    async () => {
      const claudeBinPath = resolveClaudeBinary();
      if (!claudeBinPath) {
        vscode.window.showErrorMessage(
          'Binário do Claude Code não encontrado. Certifique-se de que a extensão "Claude Code" (anthropic.claude-code) está instalada.'
        );
        return;
      }

      const gitExtension = vscode.extensions.getExtension('vscode.git');
      if (!gitExtension) {
        vscode.window.showErrorMessage('Extensão Git do VSCode não encontrada.');
        return;
      }

      const git = gitExtension.isActive
        ? gitExtension.exports
        : await gitExtension.activate();

      const api = git.getAPI(1);
      const repos = api.repositories;

      if (!repos.length) {
        vscode.window.showErrorMessage('Nenhum repositório Git encontrado no workspace.');
        return;
      }

      const repo = repos.length === 1
        ? repos[0]
        : await pickRepository(repos);

      if (!repo) {
        return;
      }

      const { diff, staged } = await getDiff(repo);

      if (!diff) {
        vscode.window.showWarningMessage('Nenhuma mudança encontrada no repositório.');
        return;
      }

      const account = await pickClaudeAccount();
      if (!account) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Commit Elaborator',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: staged ? 'Analisando staged com Claude...' : 'Analisando mudanças com Claude...' });

          const config = vscode.workspace.getConfiguration('commitElaborator');
          const language = config.get<string>('language') || 'pt-BR';
          const convention = config.get<string>('convention') || 'conventional';

          try {
            const suggestion = await suggestCommitMessage({
              diff,
              language,
              convention,
              claudeBinPath,
              oauthToken: account.oauthToken,
            });
            repo.inputBox.value = suggestion;
            vscode.window.showInformationMessage('Mensagem de commit sugerida! Revise e confirme o commit.');
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Erro ao gerar sugestão: ${message}`);
          }
        }
      );
    }
  );

  context.subscriptions.push(command);
}

function resolveClaudeBinary(): string | undefined {
  const extensionsDirs = [
    path.join(os.homedir(), '.vscode', 'extensions'),
    path.join(os.homedir(), '.vscode-server', 'extensions'),
    path.join(os.homedir(), '.cursor', 'extensions'),
  ];

  for (const dir of extensionsDirs) {
    const found = findClaudeBinary(dir);
    if (found) {
      return found;
    }
  }

  return undefined;
}

async function pickRepository(repos: Array<{ rootUri: vscode.Uri; inputBox: { value: string } }>) {
  const items = repos.map((r) => ({
    label: vscode.workspace.asRelativePath(r.rootUri),
    repo: r,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Selecione o repositório',
  });

  return picked?.repo;
}

async function getDiff(repo: { diff: (cached: boolean) => Promise<string> }): Promise<{ diff: string; staged: boolean }> {
  try {
    const staged = (await repo.diff(true)).trim();
    if (staged) {
      return { diff: staged, staged: true };
    }
    const unstaged = (await repo.diff(false)).trim();
    return { diff: unstaged, staged: false };
  } catch {
    return { diff: '', staged: false };
  }
}

interface ClaudeAccount {
  label: string;
  description: string;
  oauthToken: string;
}

function keychainServiceName(claudeDir: string): string {
  // Claude Code derives the keychain service as:
  //   "Claude Code-credentials-{first8ofSHA256(claudeDir)}"
  // The default (personal) account also has "Claude Code-credentials" (no suffix).
  const hash = crypto.createHash('sha256').update(claudeDir).digest('hex').slice(0, 8);
  return `Claude Code-credentials-${hash}`;
}

function readOauthToken(serviceName: string): string | undefined {
  try {
    const raw = execFileSync('security', ['find-generic-password', '-s', serviceName, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const parsed = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string } };
    return parsed?.claudeAiOauth?.accessToken;
  } catch {
    return undefined;
  }
}

function detectClaudeAccounts(): ClaudeAccount[] {
  const home = os.homedir();
  const accounts: ClaudeAccount[] = [];

  // Collect all ~/.claude* directories
  const candidates: Array<{ claudeDir: string; label: string }> = [];

  try {
    const entries = fs.readdirSync(home);
    for (const entry of entries) {
      if (entry === '.claude') {
        candidates.unshift({ claudeDir: path.join(home, entry), label: 'Pessoal' });
      } else if (entry.startsWith('.claude-')) {
        const suffix = entry.slice('.claude-'.length);
        candidates.push({
          claudeDir: path.join(home, entry),
          label: suffix.charAt(0).toUpperCase() + suffix.slice(1),
        });
      }
    }
  } catch { /* ignore */ }

  for (const c of candidates) {
    if (!fs.existsSync(c.claudeDir)) {
      continue;
    }

    // Try to read the OAuth token from the Keychain
    const token = readOauthToken(keychainServiceName(c.claudeDir));
    if (token) {
      accounts.push({
        label: `$(person) ${c.label}`,
        description: c.claudeDir.replace(home, '~'),
        oauthToken: token,
      });
    }
  }

  return accounts;
}

async function pickClaudeAccount(): Promise<ClaudeAccount | undefined> {
  const accounts = detectClaudeAccounts();

  if (accounts.length === 0) {
    vscode.window.showErrorMessage(
      'Nenhuma conta Claude autenticada encontrada no Keychain.'
    );
    return undefined;
  }

  if (accounts.length === 1) {
    return accounts[0];
  }

  const picked = await vscode.window.showQuickPick(
    accounts.map((a) => ({ label: a.label, description: a.description, account: a })),
    {
      title: 'Commit Elaborator — Qual conta Claude usar?',
      placeHolder: 'Selecione a conta para gerar o commit',
      ignoreFocusOut: true,
    }
  );

  return picked?.account;
}

export function deactivate() {}
