import Anthropic from '@anthropic-ai/sdk';

interface SuggestOptions {
  diff: string;
  apiKey: string;
  model: string;
  language: string;
  convention: string;
}

const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  'pt-BR': 'Escreva a mensagem de commit em português do Brasil.',
  'en-US': 'Write the commit message in English.',
};

const CONVENTION_INSTRUCTIONS: Record<string, string> = {
  conventional: `Use o formato Conventional Commits:
<tipo>(<escopo opcional>): <descrição curta>

Tipos válidos: feat, fix, docs, style, refactor, test, chore, perf, ci, build, revert.
Exemplo: feat(auth): adicionar autenticação com OAuth2`,
  free: 'Use um texto livre e descritivo, sem convenção específica.',
};

export async function suggestCommitMessage(options: SuggestOptions): Promise<string> {
  const { diff, apiKey, model, language, convention } = options;

  const client = new Anthropic({ apiKey });

  const langInstruction = LANGUAGE_INSTRUCTIONS[language] ?? LANGUAGE_INSTRUCTIONS['en-US'];
  const conventionInstruction = CONVENTION_INSTRUCTIONS[convention] ?? CONVENTION_INSTRUCTIONS['conventional'];

  const truncatedDiff = diff.length > 8000 ? diff.slice(0, 8000) + '\n\n[diff truncado...]' : diff;

  const response = await client.messages.create({
    model,
    max_tokens: 256,
    system: `Você é um assistente especializado em escrever mensagens de commit claras e concisas.
Analise o diff e gere UMA mensagem de commit adequada.
${langInstruction}
${conventionInstruction}
Responda APENAS com a mensagem de commit, sem explicações adicionais.`,
    messages: [
      {
        role: 'user',
        content: `Analise este diff e sugira uma mensagem de commit:\n\n\`\`\`diff\n${truncatedDiff}\n\`\`\``,
      },
    ],
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!textBlock) {
    throw new Error('Nenhuma sugestão foi gerada pela IA.');
  }

  return textBlock.text.trim();
}
