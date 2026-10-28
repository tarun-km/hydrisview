package ai.hydris.field.data

import ai.hydris.field.HydrisApp
import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Replays the round outbox when a network is available, also after the app was closed or the phone
 * restarted. Exponential backoff while the API is unreachable; conflicts are left for the operator.
 */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
  override suspend fun doWork(): Result {
    val app = applicationContext as HydrisApp
    if (app.outbox.pendingCount == 0) return Result.success()
    if (app.api.accessToken == null && !app.api.refresh()) return Result.retry()
    val r = app.outbox.flush(app.repo)
    return if (r.offline) Result.retry() else Result.success()
  }

  companion object {
    private const val NAME = "hydris.outbox"
    fun enqueue(context: Context) {
      val req = OneTimeWorkRequestBuilder<SyncWorker>()
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
        .build()
      WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.REPLACE, req)
    }
  }
}
