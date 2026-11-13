// GET → public polling endpoint for the display screen (no auth required)
import { supabase } from '../../_supabase.js';
import { handleCors } from '../../_auth.js';

// The public display board: the queue numbers being served, waiting and
// missed, the counts and a rough wait time. No names (decision 1).
export default async function handler(request, response) {
    if (handleCors(request, response)) {
        return;
    }
    if (request.method !== 'GET') {
        return response.status(405).json({ error: 'Method not allowed' });
    }

    const { eventCode, queueCode } = request.query;

    // Resolve event
    const { data: event } = await supabase
        .from('gftvqueue_events')
        .select('id, name')
        .eq('access_code', eventCode)
        .maybeSingle();

    if (!event) {
        return response.status(404).json({ error: 'Event not found' });
    }

    // Resolve queue
    const { data: queue } = await supabase
        .from('gftvqueue_queues')
        .select('id, name, status, max_serving, access_code')
        .eq('event_id', event.id)
        .eq('access_code', queueCode)
        .maybeSingle();

    if (!queue) {
        return response.status(404).json({ error: 'Queue not found' });
    }

    // Get entries grouped by status
    const { data: entries } = await supabase
        .from('gftvqueue_entries')
        .select('id, queue_number, status, display_name, entered_at')
        .eq('queue_id', queue.id)
        .not('status', 'eq', 'completed')
        .order('queue_number', { ascending: true });

    let liveEntries = [];
    if (entries) {
        liveEntries = entries;
    }
    const servingEntries = liveEntries.filter((entry) => entry.status === 'serving');
    const servingNumbers = servingEntries.map((entry) => entry.queue_number);
    const servingDetails = servingEntries.map((entry) => ({ queue_number: entry.queue_number, entered_at: entry.entered_at }));
    const waitingNumbers = liveEntries.filter((entry) => entry.status === 'waiting').map((entry) => entry.queue_number);
    const missedNumbers = liveEntries.filter((entry) => entry.status === 'missed').map((entry) => entry.queue_number);

    const { count: totalServed } = await supabase
        .from('gftvqueue_entries')
        .select('id', { count: 'exact', head: true })
        .eq('queue_id', queue.id)
        .eq('status', 'completed');

    let servedCount = 0;
    if (totalServed) {
        servedCount = totalServed;
    }

    // Estimate wait time: assume 2 minutes per person ahead
    const waitMinutes = waitingNumbers.length * 2;

    return response.status(200).json({
        event: {
            name: event.name
        },
        queue: {
            id: queue.id,
            name: queue.name,
            status: queue.status
        },
        serving: servingNumbers,
        serving_entries: servingDetails,
        waiting: waitingNumbers,
        missed: missedNumbers,
        total_in_queue: waitingNumbers.length,
        total_served: servedCount,
        est_wait_minutes: waitMinutes,
        updated_at: new Date().toISOString(),
        join_url: `https://queue.gftv.asia/queue/${eventCode}/${queueCode}`,
    });
}
