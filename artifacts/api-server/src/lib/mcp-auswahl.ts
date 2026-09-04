/*
 * WELCHE Werkzeuge eines MCP-Servers Lukas bekommt.
 *
 * Ein Deckel ist noetig: Higgsfield meldet 81 Werkzeuge, und die vollstaendig
 * bei jedem Modellaufruf mitzuschicken sprengt jedes Token-Limit. Nur war
 * bisher die Auswahl das Problem, nicht der Deckel: es wurden schlicht die
 * ERSTEN N genommen, in der Reihenfolge, in der der fremde Server sie
 * aufzaehlt. Ob generate_video dabei war, war Glueckssache.
 *
 * Lukas konnte damit nicht, was von ihm verlangt wurde — nicht weil er es
 * nicht verstanden haette, sondern weil das Werkzeug nicht in seinem Kasten
 * lag. Jetzt entscheidet der Zweck.
 *
 * Eigene Datei ohne Abhaengigkeiten, damit die Entscheidung fuer sich pruefbar
 * ist, ohne den halben Server mitzuziehen.
 */

const MCP_WICHTIG: RegExp[] = [
  /*
   * Die ANLEITUNG steht vor dem Werkzeug — und das ist keine Geschmacksfrage.
   *
   * Higgsfield liefert zu jeder mehrstufigen Produktion einen fertigen
   * Workflow: mehrszeniges Erzaehlvideo, Schnitt als Timeline, Figuren, die
   * ueber Clips hinweg gleich aussehen, Untertitel in die Pixel gebrannt. Der
   * Anbieter selbst sagt, dass der Workflow VOR der Erzeugung zu laden ist.
   *
   * Diese beiden standen bisher nicht in der Liste, fielen also ans Ende und
   * unter den Deckel. Lukas kam ueber mcp_search noch dran — nur hatte er
   * keinen Anlass zu wissen, dass es sie gibt. Er konnte damit sechs Clips
   * bauen, die einzeln gut und zusammen kein Film waren, ohne je zu erfahren,
   * dass die Antwort darauf beim Anbieter fertig herumlag.
   */
  /^(get_workflow_instructions|get_workflow_bundle_file)$/,
  /^generate_(image|video|audio|3d)$/, // erzeugen: der Kern
  /^(models_explore|presets_show|show_characters)$/, // was steht zur Auswahl
  /^(show_generations|show_generation_by_ids|show_medias|job_display|jobs_wait)$/, // nachsehen und blaettern
  /^(media_upload|media_import_url|media_confirm)$/, // eigenes Material hineinbringen
  /^(upscale_|outpaint_|reframe$|remove_background)/, // bearbeiten statt neu erzeugen
  /^(video_analysis_|virality_predictor)/, // auswerten
  /^(balance|show_plans_and_credits)$/, // was es kostet
];

/**
 * Nach Zweck sortieren: Wichtiges zuerst, innerhalb einer Stufe bleibt die
 * Reihenfolge des Servers erhalten. Der Rest haengt hinten und faellt zuerst
 * unter den Deckel.
 */
export function ordneMcpWerkzeuge<T extends { name: string }>(tools: T[]): T[] {
  const rang = (name: string) => {
    const i = MCP_WICHTIG.findIndex((re) => re.test(name));
    return i === -1 ? MCP_WICHTIG.length : i;
  };
  return tools
    .map((tool, i) => ({ tool, rang: rang(tool.name), i }))
    .sort((a, b) => a.rang - b.rang || a.i - b.i)
    .map((e) => e.tool);
}
