package dev.leodeng.listening

import org.json.JSONObject

fun Listen.json(): JSONObject = JSONObject().put("id", id).put("title", track.title).put("artist", track.artist)
    .put("album", track.album).put("durationMs", track.durationMs).put("startedAt", startedAt)
    .put("updatedAt", updatedAt).put("listenedMs", listenedMs).put("days", JSONObject(days as Map<*, *>))
fun decodeListen(text: String): Listen {
    val o = JSONObject(text)
    val days = o.getJSONObject("days")
    return Listen(o.getString("id"), Track(o.getString("title"), o.getString("artist"), o.getString("album"), o.getLong("durationMs")),
        o.getLong("startedAt"), o.getLong("updatedAt"), o.getLong("listenedMs"),
        days.keys().asSequence().associateWith { days.getLong(it) }.toSortedMap())
}
