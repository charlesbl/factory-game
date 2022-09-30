import React from 'react'
import '../css/Machine.css'
import Machine from '../Game/Machine'
import ManualMachine from '../Game/ManualMachine'
import IngredientsView from './IngredientsView'

interface IMachineProps {
    machine: Machine
    onDeleteMachine: () => void
    manual: boolean
}

const MachineView = (props: IMachineProps): JSX.Element => {
    const actions: JSX.Element[] = []
    if (!props.manual) {
        actions.push(<button onClick={() => props.onDeleteMachine()} className="btn btn-danger btn-side"><i className="fas fa-trash fa-xs"></i></button>)
    }
    if (props.manual) {
        const manualMachine = props.machine as ManualMachine
        const canCraft = true // TODO implement if user can manually craft

        const craftBtn = <button onMouseDown={() => { manualMachine.active = true }}
            onMouseUp={() => { manualMachine.active = false }}
            onMouseOut={() => { manualMachine.active = false }}
            className="btn btn-success btn-side btn-craft" disabled={!canCraft}>
            <i className="fas fa-hammer fa-xs"></i>
        </button>
        actions.push(craftBtn)
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
