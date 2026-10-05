{{/* Labels shared by every object. Selectors stay "app: <component>" (selectors are immutable). */}}
{{- define "tasks.labels" -}}
app.kubernetes.io/part-of: tasks
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}
