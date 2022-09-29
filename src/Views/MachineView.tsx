import React from 'react'
import { notImplemented } from '..'
import '../css/Machine.css'
import Machine from '../Game/Machine'
import IngredientsView from './IngredientsView'

interface IMachineProps {
    machine: Machine
}

const MachineView = (props: IMachineProps): JSX.Element => {
    const canCraft = true // TODO implement if user can manually craft
    const craftBtn = <button onMouseDown={() => notImplemented()}
        onMouseUp={() => notImplemented()}
        onMouseOut={() => notImplemented()}
        className="btn btn-success btn-side btn-craft" disabled={!canCraft}>
        <i className="fas fa-hammer fa-xs"></i>
    </button>

    const destroyBtn = <button onClick={() => notImplemented()} className="btn btn-danger btn-side"><i className="fas fa-trash fa-xs"></i></button>
    const actions = props.machine.manual ? <div className="btn-wrapper">{craftBtn}</div> : <div className="btn-wrapper">{destroyBtn}</div>
    return (
        <div className="machine">
            <div className="name">{props.machine.name}</div>
            <div className="wrapper">
                <IngredientsView ingredients={props.machine.craft.input} />
                <div>
                    <div className="arrow"><i className="fas fa-arrow-right fa-10px"></i></div>
                    <div>58%</div>
                    {actions}
                </div>
                <IngredientsView ingredients={props.machine.craft.output} />
            </div>
        </div>
    )
}
export default MachineView
