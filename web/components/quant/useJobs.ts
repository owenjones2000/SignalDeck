"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { quantRequest } from "../../lib/quant/client";
import type { Job, JobKind } from "../../lib/quant/types";

export function useJobs(kind: JobKind) {
    const client = useQueryClient();
    const [selected, setSelected] = useState<string | null>(null);
    const jobs = useQuery({ queryKey: ["quant", "jobs"], queryFn: () => quantRequest<Job[]>("/jobs"), retry: false, refetchInterval: 5000 });
    const detail = useQuery({
        queryKey: ["quant", "job", selected],
        queryFn: () => quantRequest<Job>(`/jobs/${encodeURIComponent(selected!)}`),
        enabled: selected !== null, retry: false,
        refetchInterval: (query) => {
            const state = query.state.data?.status;
            return !query.state.error && (state === "queued" || state === "running") ? 1000 : false;
        },
    });
    const submit = useMutation({
        mutationFn: (params: Record<string, unknown>) => quantRequest<Job>("/jobs", "POST", { kind, params }),
        onSuccess: (job) => {
            client.setQueryData(["quant", "job", job.id], job);
            setSelected(job.id);
            client.invalidateQueries({ queryKey: ["quant", "jobs"] });
        },
    });
    return { jobs, detail, submit, selected, setSelected, history: jobs.data?.filter((job) => job.kind === kind) ?? [] };
}
