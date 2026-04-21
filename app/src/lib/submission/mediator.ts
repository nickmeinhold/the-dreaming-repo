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
  ) {}

  async submit(
    validated: ValidatedSubmission,
  ): Promise<Result<{ paperId: string }>> {
    // Step 1: Generate ID
    let paperId: string;
    try {
      paperId = await this.idGenerator.next(null);
    } catch (e) {
      return err(`ID generation failed: ${(e as Error).message}`);
    }

    // Step 2: Create paper record
    const createResult = await this.repository.create(
      paperId,
      validated,
      null,
    );
    if (createResult.isErr()) return err(createResult.error);

    // Step 3: Store files
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
