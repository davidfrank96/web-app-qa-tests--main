export function tokenlessContentObserved(
  probes: Array<{context:string;bodySample:string}>,
  artifacts: Array<{subject?:string;message?:string}>
): boolean {
  return probes.filter(probe => probe.context === "logged-out-tokenless" || probe.context === "authenticated-tokenless")
    .some(probe => artifacts.some(artifact => Boolean(artifact.subject && probe.bodySample.includes(artifact.subject)) || Boolean(artifact.message && probe.bodySample.includes(artifact.message))));
}
