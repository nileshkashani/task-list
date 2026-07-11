import { useState, useEffect, useRef } from 'react'
import { 
  Plus, 
  Trash2, 
  Edit3, 
  Check, 
  Calendar, 
  Settings, 
  AlertCircle, 
  Loader2, 
  ChevronLeft, 
  ChevronRight, 
  RefreshCw, 
  CheckCircle2,
  ListTodo
} from 'lucide-react'
import { supabase } from './supabaseClient'

export default function App() {
  // --- State Variables ---
  const [selectedDate, setSelectedDate] = useState(() => {
    return new Date().toISOString().split('T')[0] // 'YYYY-MM-DD'
  })
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [newTaskName, setNewTaskName] = useState('')
  const [editingTaskId, setEditingTaskId] = useState(null)
  const [editingText, setEditingText] = useState('')
  
  // Settings & Table configuration
  const [tableName, setTableName] = useState('task')
  const [showSettings, setShowSettings] = useState(false)
  const [tempTableName, setTempTableName] = useState(tableName)

  // Toast notifications state
  const [toasts, setToasts] = useState([])

  // Re-fetch trigger
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // Input ref
  const editInputRef = useRef(null)

  // --- Helpers for Date Boundaries ---
  // Returns timezone-correct start and end of day ISO strings
  const getDateRange = (dateStr) => {
    // dateStr is 'YYYY-MM-DD'
    const start = new Date(`${dateStr}T00:00:00`)
    const end = new Date(`${dateStr}T23:59:59.999`)
    return {
      start: start.toISOString(),
      end: end.toISOString()
    }
  }

  // Prepares the correct timestamp for new tasks
  const getInsertTimestamp = (dateStr) => {
    const todayStr = new Date().toISOString().split('T')[0]
    if (dateStr === todayStr) {
      return new Date().toISOString()
    } else {
      const now = new Date()
      // Use selected date but current local time
      const targetDate = new Date(`${dateStr}T${now.toTimeString().split(' ')[0]}.${now.getMilliseconds()}`)
      return targetDate.toISOString()
    }
  }

  // Generate 7 days around the selected date for the timeline
  const getTimelineDays = (centerDateStr) => {
    const days = []
    const centerDate = new Date(`${centerDateStr}T12:00:00`) // avoid timezone rollover issues
    for (let i = -3; i <= 3; i++) {
      const d = new Date(centerDate)
      d.setDate(centerDate.getDate() + i)
      const dateStr = d.toISOString().split('T')[0]
      days.push({
        dateStr,
        dayNum: d.getDate(),
        dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
        monthName: d.toLocaleDateString('en-US', { month: 'short' }),
        isToday: d.toISOString().split('T')[0] === new Date().toISOString().split('T')[0]
      })
    }
    return days
  }

  const timelineDays = getTimelineDays(selectedDate)

  // --- Toast Manager ---
  const addToast = (message, type = 'success') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }

  // --- Supabase API Calls ---

  // 1. GET: Fetch tasks for the selected date
  const fetchTasks = async (dateStr) => {
    setLoading(true)
    const { start, end } = getDateRange(dateStr)

    try {
      const { data, error } = await supabase
        .from(tableName)
        .select()
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: true })
      console.log(data)
      if (error) throw error
      setTasks(data || [])
    } catch (error) {
      console.error('Error fetching tasks:', error)
      addToast(`Fetch failed: ${error.message}. Is table name correct?`, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Fetch tasks whenever date, tableName, or manual refresh changes
  useEffect(() => {
    fetchTasks(selectedDate)
  }, [selectedDate, tableName, refreshTrigger])

  // Focus input when editing starts
  useEffect(() => {
    if (editingTaskId && editInputRef.current) {
      editInputRef.current.focus()
    }
  }, [editingTaskId])

  // 2. POST: Add a new task
  const handleAddTask = async (e) => {
    e.preventDefault()
    if (!newTaskName.trim()) return

    const taskNameStr = newTaskName.trim()
    setNewTaskName('')

    // Create optimistic task
    const tempId = -Date.now()
    const timestamp = getInsertTimestamp(selectedDate)
    const optimisticTask = {
      id: tempId,
      taskName: taskNameStr,
      isCompleted: false,
      created_at: timestamp
    }

    // Update UI immediately
    setTasks(prev => [...prev, optimisticTask])

    try {
      const { data, error } = await supabase
        .from(tableName)
        .insert([{ 
          taskName: taskNameStr, 
          isCompleted: false,
          created_at: timestamp 
        }])
        .select()

      if (error) throw error

      if (data && data[0]) {
        // Replace optimistic task with db task
        setTasks(prev => prev.map(t => t.id === tempId ? data[0] : t))
        addToast('Task added successfully')
      }
    } catch (error) {
      console.error('Error adding task:', error)
      // Rollback optimistic update
      setTasks(prev => prev.filter(t => t.id !== tempId))
      addToast(`Add failed: ${error.message}`, 'error')
    }
  }

  // 3. PUT (Update Completion): Toggle isCompleted
  const handleToggleCompleted = async (task) => {
    const newStatus = !task.isCompleted

    // Optimistic update
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, isCompleted: newStatus } : t))

    try {
      const { error } = await supabase
        .from(tableName)
        .update({ isCompleted: newStatus })
        .eq('id', task.id)

      if (error) throw error
      addToast(newStatus ? 'Task marked complete' : 'Task marked incomplete')
    } catch (error) {
      console.error('Error updating status:', error)
      // Rollback
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, isCompleted: !newStatus } : t))
      addToast(`Update failed: ${error.message}`, 'error')
    }
  }

  // 4. PUT (Rename Task): Save inline edits
  const handleSaveRename = async (id) => {
    if (!editingText.trim()) return
    const originalTask = tasks.find(t => t.id === id)
    if (!originalTask || originalTask.taskName === editingText.trim()) {
      setEditingTaskId(null)
      return
    }

    const updatedText = editingText.trim()
    setEditingTaskId(null)

    // Optimistic update
    setTasks(prev => prev.map(t => t.id === id ? { ...t, taskName: updatedText } : t))

    try {
      const { error } = await supabase
        .from(tableName)
        .update({ taskName: updatedText })
        .eq('id', id)

      if (error) throw error
      addToast('Task renamed')
    } catch (error) {
      console.error('Error renaming task:', error)
      // Rollback
      setTasks(prev => prev.map(t => t.id === id ? { ...t, taskName: originalTask.taskName } : t))
      addToast(`Rename failed: ${error.message}`, 'error')
    }
  }

  // 5. DELETE: Delete a task
  const handleDeleteTask = async (id) => {
    const deletedTask = tasks.find(t => t.id === id)
    
    // Optimistic update
    setTasks(prev => prev.filter(t => t.id !== id))

    try {
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', id)

      if (error) throw error
      addToast('Task deleted')
    } catch (error) {
      console.error('Error deleting task:', error)
      // Rollback
      if (deletedTask) {
        setTasks(prev => [...prev, deletedTask].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)))
      }
      addToast(`Delete failed: ${error.message}`, 'error')
    }
  }

  // --- Custom Table Name Save ---
  const saveTableSettings = () => {
    const finalName = tempTableName.trim() || 'tasks'
    setTableName(finalName)
    localStorage.setItem('supabase_tasks_table', finalName)
    setShowSettings(false)
    addToast(`Switched table to "${finalName}"`)
  }

  // --- Quick Date Navigation ---
  const changeDateByOffset = (days) => {
    const current = new Date(`${selectedDate}T12:00:00`)
    current.setDate(current.getDate() + days)
    setSelectedDate(current.toISOString().split('T')[0])
  }

  const snapToToday = () => {
    setSelectedDate(new Date().toISOString().split('T')[0])
  }

  // --- Statistics ---
  const totalTasksCount = tasks.length
  const completedTasksCount = tasks.filter(t => t.isCompleted).length
  const completionPercentage = totalTasksCount > 0 ? Math.round((completedTasksCount / totalTasksCount) * 100) : 0

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center p-4 sm:p-6 overflow-x-hidden">
      
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[350px] sm:w-[500px] h-[350px] sm:h-[500px] bg-indigo-600/10 blur-[80px] sm:blur-[120px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-[350px] sm:w-[500px] h-[350px] sm:h-[500px] bg-purple-600/10 blur-[80px] sm:blur-[120px] rounded-full pointer-events-none"></div>

      {/* Main glass panel */}
      <div className="glass-panel w-full max-w-2xl rounded-2xl sm:rounded-3xl p-6 sm:p-8 flex flex-col gap-6 relative z-10 animate-slide-up">
        
        {/* Header Section */}
        <div className="flex items-center justify-between border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-xl shadow-lg shadow-indigo-500/20">
              <ListTodo className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-200 via-purple-100 to-pink-200">
                Nilesh's Tasks
              </h1>
              <p className="text-xs text-slate-400 font-medium">Elevating your daily focus</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setRefreshTrigger(prev => prev + 1)}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition duration-150 active:scale-95"
              title="Refresh database connection"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition duration-150 active:scale-95"
              title="Database Settings"
            >
              <Settings className={`w-5 h-5 ${showSettings ? 'text-indigo-400 rotate-45' : ''} transition-transform duration-300`} />
            </button>
          </div>
        </div>

        {/* Database Table Settings Overlay */}
        {showSettings && (
          <div className="bg-slate-900/90 border border-white/10 rounded-xl p-4 sm:p-5 flex flex-col gap-3 animate-fade-in">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Supabase Table Name</label>
              <input
                type="text"
                value={tempTableName}
                onChange={(e) => setTempTableName(e.target.value)}
                placeholder="e.g. tasks"
                className="glass-input text-sm rounded-lg px-3 py-2 w-full"
              />
              <p className="text-[10px] text-slate-500 leading-relaxed">
                By default, this app queries the <code className="text-slate-300">tasks</code> table. If your table has a different name in your database, modify it here.
              </p>
            </div>
            <div className="flex gap-2 justify-end mt-1">
              <button 
                onClick={() => {
                  setTempTableName(tableName)
                  setShowSettings(false)
                }}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white rounded hover:bg-white/5 transition"
              >
                Cancel
              </button>
              <button 
                onClick={saveTableSettings}
                className="px-3 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-500 font-medium rounded transition active:scale-95"
              >
                Save Settings
              </button>
            </div>
          </div>
        )}

        {/* Date Selector Row */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button 
                onClick={() => changeDateByOffset(-1)}
                className="p-1 text-slate-400 hover:text-white rounded hover:bg-white/5 transition active:scale-90"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <h2 className="text-base sm:text-lg font-semibold text-slate-200">
                {new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-US', { 
                  month: 'long', 
                  day: 'numeric', 
                  year: 'numeric' 
                })}
              </h2>
              <button 
                onClick={() => changeDateByOffset(1)}
                className="p-1 text-slate-400 hover:text-white rounded hover:bg-white/5 transition active:scale-90"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button 
                onClick={snapToToday}
                className="px-2.5 py-1 text-xs font-semibold tracking-wide uppercase text-indigo-400 hover:text-indigo-300 rounded border border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/10 transition active:scale-95"
              >
                Today
              </button>
              
              <div className="relative group">
                <input 
                  type="date" 
                  value={selectedDate}
                  onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full"
                />
                <button className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition pointer-events-none">
                  <Calendar className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Timeline week rolling cards */}
          <div className="grid grid-cols-7 gap-2">
            {timelineDays.map((day) => {
              const isSelected = day.dateStr === selectedDate
              return (
                <button
                  key={day.dateStr}
                  onClick={() => setSelectedDate(day.dateStr)}
                  className={`flex flex-col items-center py-2.5 rounded-xl border transition-all duration-200 ${
                    isSelected
                      ? 'bg-gradient-to-b from-indigo-600/90 to-purple-600/90 border-indigo-400/50 shadow-md shadow-indigo-500/15 scale-105 text-white'
                      : 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200'
                  }`}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wider opacity-85">
                    {day.dayName}
                  </span>
                  <span className="text-base font-bold my-0.5">
                    {day.dayNum}
                  </span>
                  <span className="text-[9px] font-medium opacity-70">
                    {day.monthName}
                  </span>
                  {day.isToday && (
                    <span className={`w-1 h-1 rounded-full mt-1.5 ${isSelected ? 'bg-white' : 'bg-indigo-400'}`}></span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Progress Bar */}
        {totalTasksCount > 0 && (
          <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Completion Status</span>
              </span>
              <span>{completedTasksCount} / {totalTasksCount} completed ({completionPercentage}%)</span>
            </div>
            <div className="w-full bg-slate-900/60 rounded-full h-2 overflow-hidden border border-white/5">
              <div 
                className="bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500 h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: `${completionPercentage}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Task Form */}
        <form onSubmit={handleAddTask} className="flex gap-2">
          <input
            type="text"
            value={newTaskName}
            onChange={(e) => setNewTaskName(e.target.value)}
            placeholder="Add a new task..."
            className="glass-input flex-1 px-4 py-3 rounded-xl text-sm"
          />
          <button
            type="submit"
            disabled={!newTaskName.trim()}
            className="px-4 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-medium hover:from-indigo-600 hover:to-purple-600 transition shadow-lg shadow-indigo-500/10 hover:shadow-indigo-500/20 active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-1.5 text-sm"
          >
            <Plus className="w-5 h-5" />
            <span className="hidden sm:inline">Add Task</span>
          </button>
        </form>

        {/* Task List container */}
        <div className="flex flex-col gap-2 min-h-[160px] max-h-[350px] overflow-y-auto pr-1">
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 h-full py-12">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
              <p className="text-sm font-medium tracking-wide">Syncing with database...</p>
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center py-10 rounded-2xl bg-white/[0.01] border border-dashed border-white/5">
              <div className="p-3 bg-white/5 rounded-full text-slate-400">
                <Calendar className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-300">No tasks planned</p>
                <p className="text-xs text-slate-500 max-w-[240px] mt-1 leading-relaxed">
                  Start mapping your day by adding tasks above for this date.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {tasks.map((task) => {
                const isOptimistic = task.id < 0
                const isEditing = editingTaskId === task.id

                return (
                  <div
                    key={task.id}
                    className={`glass-card flex items-center justify-between p-3.5 rounded-xl border ${
                      task.isCompleted ? 'opacity-65 border-white/[0.02]' : 'border-white/5'
                    } ${isOptimistic ? 'animate-pulse pointer-events-none bg-indigo-500/5 border-indigo-500/10' : ''}`}
                  >
                    <div className="flex items-center gap-3.5 flex-1 min-w-0">
                      {/* Completion checkmark */}
                      <button
                        type="button"
                        onClick={() => handleToggleCompleted(task)}
                        className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all duration-200 ${
                          task.isCompleted
                            ? 'bg-gradient-to-tr from-emerald-500 to-emerald-400 border-emerald-300/40 text-slate-900 shadow-md shadow-emerald-500/10'
                            : 'border-white/20 hover:border-indigo-400/50 hover:bg-white/5'
                        } active:scale-90`}
                      >
                        {task.isCompleted && <Check className="w-3.5 h-3.5 stroke-[3px]" />}
                      </button>

                      {/* Task Name inline rename or display */}
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onBlur={() => handleSaveRename(task.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRename(task.id)
                            if (e.key === 'Escape') setEditingTaskId(null)
                          }}
                          className="bg-slate-900/60 border border-indigo-500/30 rounded px-2.5 py-1 text-sm text-white w-full focus:outline-none focus:border-indigo-400/60 font-medium"
                        />
                      ) : (
                        <span
                          onDoubleClick={() => {
                            setEditingTaskId(task.id)
                            setEditingText(task.taskName)
                          }}
                          className={`text-sm font-medium leading-relaxed truncate select-none cursor-pointer ${
                            task.isCompleted ? 'line-through text-slate-500' : 'text-slate-200'
                          }`}
                          title="Double click to edit task name"
                        >
                          {task.taskName}
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 ml-3">
                      {!isEditing && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTaskId(task.id)
                            setEditingText(task.taskName)
                          }}
                          className="p-1.5 text-slate-400 hover:text-indigo-400 rounded-lg hover:bg-white/5 transition"
                          title="Edit task name"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteTask(task.id)}
                        className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-white/5 transition"
                        title="Delete task"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Floating toast notification panel */}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-xl animate-fade-in pointer-events-auto ${
              toast.type === 'error'
                ? 'bg-red-950/80 border-red-800/40 text-red-200'
                : 'bg-slate-900/90 border-white/10 text-indigo-200'
            }`}
          >
            {toast.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span className="text-xs font-medium leading-relaxed">{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
