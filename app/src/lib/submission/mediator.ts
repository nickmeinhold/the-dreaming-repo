/**
 * Submission Mediator — Kleisli Pipeline for Paper Submission
 *
 * Coordinates the submission pipeline without any step knowing
 * about the others. Each step is a Kleisli arrow A → Result<B>,
 * and the mediator composes them with short-circuit on error.
 *
 * Pipeline: generateId → createPaper → storeFiles → updatePaths
 */

import { ok, err, type Result } from "@/lib/result";

// ── Step interfaces (injected, not imported) ───────────────

export interface ValidatedSubmission {
  title: string;
  abstract: string;
  category: "research" | "expository";
  tags: string[];
  pdf: Buffer;
  latex?: Buffer;
  authorId: number;
  authorName: string;
  authorType: string;
  authorGithub: string;
  authorHuman: string | null;
}

export interface FilePaths {
  pdfPath: string;
  latexPath: string | null;
}

export interface TransactionContext {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface IdGenerator {
  next(tx: unknown): Promise<string>;
}

export interface PaperRepository {
  create(
    paperId: string,
    data: ValidatedSubmission,
    tx: unknown,
  ): Promise<Result<{ id: number }>>;
  updatePaths(paperId: string, paths: FilePaths): Promise<Result<void>>;
}

export interface StorageService {
  store(
    paperId: string,
    data: ValidatedSubmission,
  ): Promise<Result<FilePaths>>;
}

// ── Mediator ───────────────────────────────────────────────

export class SubmissionMediator {
  constructor(
    private readonly idGenerator: IdGenerator,
    private readonly repository: PaperRepository,
    private readonly storage: StorageService,
    private readonly txContext: TransactionContext,
  ) {}

  async submit(
    validated: ValidatedSubmission,
  ): Promise<Result<{ paperId: string }>> {
    // Steps 1-2 run inside a transaction for atomicity
    let paperId: string;
    let createResult: Result<{ id: number }>;

    try {
      ({ paperId, createResult } = await this.txContext.run(async (tx) => {
        const id = await this.idGenerator.next(tx);
        const result = await this.repository.create(id, validated, tx);
        return { paperId: id, createResult: result };
      }));
    } catch (e) {
      return err(`Transaction failed: ${(e as Error).message}`);
    }

    if (createResult.isErr()) return err(createResult.error);

    // Step 3: Store files (outside transaction — filesystem is not transactional)
    const storeResult = await this.storage.store(paperId, validated);
    if (storeResult.isErr()) return err(storeResult.error);

    // Step 4: Update paths
    const updateResult = await this.repository.updatePaths(
      paperId,
      storeResult.value,
    );
    if (updateResult.isErr()) return err(updateResult.error);

    return ok({ paperId });
  }
}
