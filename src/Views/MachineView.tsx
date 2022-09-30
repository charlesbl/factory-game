import React from 'react'
import '../css/Machine.css'
import Machine from '../Game/Machine'
import IngredientsView from './IngredientsView'

interface IMachineProps {
    machine: Machine
    onDeleteMachine?: () => void
    manual: boolean
    onTogglePauseMachine?: () => void
}

const MachineView = (props: IMachineProps): JSX.Element => {
    const actions: JSX.Element[] = []
    if (props.manual) {
        const manualMachine = props.machine
        const canCraft = true // TODO implement if user can manually craft

        const craftBtn = <button onMouseDown={() => { manualMachine.active = true }}
            onMouseUp={() => { manualMachine.active = false }}
            onMouseOut={() => { manualMachine.active = false }}
            className="btn btn-success btn-side btn-craft" disabled={!canCraft}>
            <i className="fas fa-hammer fa-xs"></i>
        </button>
        actions.push(craftBtn)
    } else {
        actions.push(<button onClick={() => props.onDeleteMachine?.()} className="btn btn-danger btn-side"><i className="fas fa-trash fa-xs"></i></button>)
        actions.push(<button onClick={() => {
            props.machine.active = !props.machine.active
            props.onTogglePauseMachine?.()
        }} className="btn btn-warning btn-side">{!props.machine.active ? <i className="fas fa-play fa-xs"></i> : <i className="fas fa-pause fa-xs"></i>}</button>)
    }
    return (
        <div className="machine">
            <div className="name">{props.machine.name}</div>
            <div className="wrapper">
                <IngredientsView ingredients={props.machine.craft.input} />
                <div>
                    <div className="arrow"><i className="fas fa-arrow-right fa-10px"></i></div>
                    <div>58%</div>
                    {actions.map((btn, i) => <div key={i} className="btn-wrapper">{btn}</div>)}
                </div>
                <IngredientsView ingredients={props.machine.craft.output} />
            </div>
        </div>
    )
}
export default MachineView
