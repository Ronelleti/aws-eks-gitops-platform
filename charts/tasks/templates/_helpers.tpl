{{/* Labels shared by every object. Selectors stay "app: <component>" (selectors are immutable). */}}
{{- define "tasks.labels" -}}
app.kubernetes.io/part-of: tasks
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{/*
The API pod, written once. The Deployment (kind, and any environment without Argo Rollouts) and the
canary Rollout (EKS) both use it, so the two can never drift apart. Call it with the root context.
*/}}
{{- define "tasks.apiPodTemplate" -}}
metadata:
  labels:
    app: api
    {{- include "tasks.labels" . | nindent 4 }}
  annotations:
    # ConfigMap changes don't restart pods by themselves. This hash changes when the
    # ConfigMap changes, which changes the pod template and triggers a rolling update.
    checksum/config: {{ include (print $.Template.BasePath "/api-configmap.yaml") . | sha256sum }}
spec:
  serviceAccountName: api
  topologySpreadConstraints:
    - maxSkew: 1
      topologyKey: kubernetes.io/hostname
      whenUnsatisfiable: ScheduleAnyway
      labelSelector:
        matchLabels: { app: api }
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
  containers:
    - name: api
      image: "{{ .Values.api.image.repository }}:{{ .Values.api.image.tag }}"
      imagePullPolicy: {{ .Values.api.image.pullPolicy }}
      ports:
        - name: http
          containerPort: 3000
      envFrom:
        - configMapRef: { name: api-config }
      env:
        # shown on the UI's System page and added to every log line
        - name: NODE_NAME
          valueFrom: { fieldRef: { fieldPath: spec.nodeName } }
        - name: POD_NAMESPACE
          valueFrom: { fieldRef: { fieldPath: metadata.namespace } }
        - name: DB_USER
          valueFrom: { secretKeyRef: { name: {{ .Values.database.credentialsSecret }}, key: username } }
        - name: DB_PASSWORD
          valueFrom: { secretKeyRef: { name: {{ .Values.database.credentialsSecret }}, key: password } }
        # Demo only. Set here (not in the ConfigMap) so it belongs to ONE version of the pod:
        # an old pod that restarts during a rollout must not pick up the new version's value.
        - name: FAULT_ERROR_RATE
          value: {{ .Values.api.faultErrorRate | quote }}
      readinessProbe:
        httpGet: { path: /readyz, port: http }
        periodSeconds: 5
      livenessProbe:
        httpGet: { path: /healthz, port: http }
        initialDelaySeconds: 10
        periodSeconds: 10
      resources:
        {{- toYaml .Values.api.resources | nindent 8 }}
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities: { drop: ["ALL"] }
{{- end }}
