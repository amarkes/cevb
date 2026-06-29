import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface SuggestOptions {
  diff: string;
  language: string;
  convention: string;
  claudeBinPath: string;
  oauthToken: string;
}

const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  'pt-BR': 'Escreva a mensagem de commit em português do Brasil.',
  'en-US': 'Write the commit message in English.',
};

const CONVENTION_INSTRUCTIONS: Record<string, string> = {
  conventional: `Use o formato Conventional Commits: <tipo>(<escopo opcional>): <descrição curta>
Tipos válidos: feat, fix, docs, style, refactor, test, chore, perf, ci, build, revert.`,
  free: 'Use um texto livre e descritivo, sem convenção específica.',
};

export function findClaudeBinary(extensionsDir: string): string | undefined {
  if (fs.existsSync(extensionsDir)) {
    const entries = fs.readdirSync(extensionsDir);
    // Pick the highest version if multiple exist
    const claudeExt = entries
      .filter((e) => e.startsWith('anthropic.claude-code-'))
      .sort()
      .at(-1);
    if (claudeExt) {
      const candidate = path.join(extensionsDir, claudeExt, 'resources', 'native-binary', 'claude');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

export async function suggestCommitMessage(options: SuggestOptions): Promise<string> {
  const { diff, language, convention, claudeBinPath, oauthToken } = options;

  const langInstruction = LANGUAGE_INSTRUCTIONS[language] ?? LANGUAGE_INSTRUCTIONS['en-US'];
  const conventionInstruction = CONVENTION_INSTRUCTIONS[convention] ?? CONVENTION_INSTRUCTIONS['conventional'];

  const truncatedDiff = diff.length > 8000 ? diff.slice(0, 8000) + '\n\n[diff truncado...]' : diff;

  const systemPrompt =
    `Você é um assistente especializado em escrever mensagens de commit claras e concisas. ` +
    `Analise o diff e gere UMA mensagem de commit adequada. ` +
    `${langInstruction} ${conventionInstruction} ` +
    `Responda APENAS com a mensagem de commit, sem explicações adicionais.`;

  const userPrompt = `Analise este diff e sugira uma mensagem de commit:\n\n\`\`\`diff\n${truncatedDiff}\n\`\`\``;

  return new Promise((resolve, reject) => {
    const args = [
      '--print',
      '--output-format', 'text',
      '--dangerously-skip-permissions',
      '--system-prompt', systemPrompt,
      userPrompt,
    ];

    const env = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: oauthToken };

    let stdout = '';
    let stderr = '';

    const child = execFile(claudeBinPath, args, { timeout: 60_000, env });

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        // Show stderr if available, otherwise show stdout (some CLIs write errors there)
        const errText = stderr.trim() || stdout.trim() || `Processo encerrou com código ${code}`;
        reject(new Error(errText));
        return;
      }
      const result = stdout.trim();
      if (!result) {
        reject(new Error('Claude não retornou nenhuma sugestão.'));
        return;
      }
      resolve(result);
    });

    child.stdin?.end();
  });
}
