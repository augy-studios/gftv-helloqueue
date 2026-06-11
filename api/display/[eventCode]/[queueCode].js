// GET → public polling endpoint for the display screen (no auth required)
import {
    supabase
} from '../../_supabase.js';
import {
    handleCors
} from '../../_auth.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({
        error: 'Method not allowed'
    });

    const {
        eventCode,
        queueCode
    } = req.query;

    // Resolve event
    const {
        data: event
    } = await supabase
        .from('gftvqueue_events')
        .select('id, name')
        .eq('access_code', eventCode)
        .maybeSingle();

    if (!event) return res.status(404).json({
        error: 'Event not found'
    });

    // Resolve queue
    const {
        data: queue
    } = await supabase
        .from('gftvqueue_queues')
        .select('id, name, status, max_serving, access_code')
        .eq('event_id', event.id)
        .eq('access_code', queueCode)
        .maybeSingle();

    if (!queue) return res.status(404).json({
        error: 'Queue not found'
    });

    // Get entries grouped by status
    const {
        data: entries
    } = await supabase
        .from('gftvqueue_entries')
        .select('id, queue_number, status, display_name')
        .eq('queue_id', queue.id)
        .not('status', 'eq', 'completed')
        .order('queue_number', {
            ascending: true
        });

    const serving = (entries || []).filter(e => e.status === 'serving').map(e => e.queue_number);
    const waiting = (entries || []).filter(e => e.status === 'waiting').map(e => e.queue_number);
    const missed = (entries || []).filter(e => e.status === 'missed').map(e => e.queue_number);

    const {
        count: totalServed
    } = await supabase
        .from('gftvqueue_entries')
        .select('id', {
            count: 'exact',
            head: true
        })
        .eq('queue_id', queue.id)
        .eq('status', 'completed');

    // Estimate wait time: assume 2 minutes per person ahead
    const waitMinutes = waiting.length * 2;

    return res.status(200).json({
        event: {
            name: event.name
        },
        queue: {
            name: queue.name,
            status: queue.status
        },
        serving,
        waiting,
        missed,
        total_in_queue: waiting.length,
        total_served: totalServed || 0,
        est_wait_minutes: waitMinutes,
        updated_at: new Date().toISOString(),
        join_url: `https://queue.gftv.asia/queue/${eventCode}/${queueCode}`,
    });
}