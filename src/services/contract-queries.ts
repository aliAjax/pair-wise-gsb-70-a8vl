import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReviewState } from '../models/contract';
import type { CandidateFieldEdit, MergeableField } from '../models/candidate';
import {
  addExemption,
  bulkReviewChanges,
  commitCandidateEdits,
  discardCandidate,
  getContract,
  listCandidates,
  listContracts,
  publishVersion,
  rebaseCandidate,
  resolveCandidateConflict,
  reviewChange,
  rollbackVersion,
  saveContract,
  startCandidate,
  type StartCandidateInput,
} from './contract-service';

export const contractKeys = {
  all: ['contracts'] as const,
  detail: (id: string) => ['contracts', id] as const,
};

export function useContracts() {
  return useQuery({
    queryKey: contractKeys.all,
    queryFn: listContracts,
  });
}

export function useContract(id: string) {
  return useQuery({
    queryKey: contractKeys.detail(id),
    queryFn: () => getContract(id),
    enabled: Boolean(id),
  });
}

export function useCandidates(contractId?: string) {
  return useQuery({
    queryKey: contractId ? ['candidates', contractId] : ['candidates'],
    queryFn: () => listCandidates(contractId),
  });
}

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['contracts'] });
  queryClient.invalidateQueries({ queryKey: ['candidates'] });
}

export function useReviewChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      contractId: string;
      changeId: string;
      state: ReviewState;
      reviewer: string;
      comment: string;
    }) =>
      reviewChange(
        input.contractId,
        input.changeId,
        input.state,
        input.reviewer,
        input.comment,
      ),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useBulkReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      selections: Array<{ contractId: string; changeId: string }>;
      state: ReviewState;
      reviewer: string;
      comment: string;
    }) =>
      bulkReviewChanges(
        input.selections,
        input.state,
        input.reviewer,
        input.comment,
      ),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useSaveContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveContract,
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useAddExemption() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { contractId: string; changeId: string; reason: string }) =>
      addExemption(input.contractId, input.changeId, input.reason),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useStartCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StartCandidateInput) => startCandidate(input),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ['candidates', input.contractId] });
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
  });
}

export function useDiscardCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (candidateId: string) => discardCandidate(candidateId),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useRebaseCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (candidateId: string) => rebaseCandidate(candidateId),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useCommitCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      candidateId: string;
      fieldEdits: Array<{ changeId: string; field: MergeableField; value: string }>;
      openApi?: { value: string };
    }) => commitCandidateEdits(input),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useResolveConflict() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      candidateId: string;
      changeId: string;
      field: CandidateFieldEdit['field'] | 'openapi';
      choice: 'mine' | 'theirs' | 'combined';
      combinedValue?: string;
    }) => resolveCandidateConflict(input),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function usePublishVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      contractId: string;
      version: string;
      notes: string;
      baselineId: string;
      consumerImpactSummary: string;
    }) => publishVersion(input),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useRollbackVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { contractId: string; versionId: string; reason: string }) =>
      rollbackVersion(input),
    onSuccess: () => invalidateAll(queryClient),
  });
}
