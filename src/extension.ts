import * as vscode from 'vscode';
import { suggestCommitMessage } from './commitSuggester';

export function activate(context: vscode.ExtensionContext) {
  const command = vscode.commands.registerCommand(
    'commitElaborator.suggestMessage',
    async () => {
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

      const diff = await getStagedDiff(repo);

      if (!diff) {
        vscode.window.showWarningMessage(
          'Nenhuma mudança staged encontrada. Adicione arquivos com "git add" antes.'
        );
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Commit Elaborator',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Analisando mudanças com IA...' });

          const config = vscode.workspace.getConfiguration('commitElaborator');
          const apiKey = config.get<string>('anthropicApiKey') || process.env.ANTHROPIC_API_KEY || '';
          const model = config.get<string>('model') || 'claude-haiku-4-5-20251001';
          const language = config.get<string>('language') || 'pt-BR';
          const convention = config.get<string>('convention') || 'conventional';

          if (!apiKey) {
            vscode.window.showErrorMessage(
              'Chave de API Anthropic não configurada. Defina em Configurações > Commit Elaborator > Anthropic Api Key ou na variável ANTHROPIC_API_KEY.'
            );
            return;
          }

          try {
            const suggestion = await suggestCommitMessage({ diff, apiKey, model, language, convention });
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

async function getStagedDiff(repo: { diff: (cached: boolean) => Promise<string> }): Promise<string> {
  try {
    const diff = await repo.diff(true);
    return diff.trim();
  } catch {
    return '';
  }
}

export function deactivate() {}
